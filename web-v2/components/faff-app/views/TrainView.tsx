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
import { createPortal } from 'react-dom';
import type { FaffSeed } from '../types';
import { PHASE, SEASON_TYPE_COLOR, type Mesh, type PhaseKey } from '../constants';
import { buildAdaptText } from '../adapt-text';
import { formatRaceTime } from '@/lib/training/vdot';
// 2026-06-03 · per-distance phase + race-day copy author. Replaces the
// hardcoded marathon strings in PHASE constants. A half-marathon plan
// no longer reads "sub-3 gets built" or "Hold 6:51/mi at CIM."
import { phaseFocus } from '@/lib/faff/phase-focus';
// 2026-06-03 · canonical one-word workout title (TEMPO / INTERVALS /
// LONG / etc) per David: "We dont show names like this, they should
// be TEMPO, INTERVAL, etc." Three Train surfaces were rendering the
// sub_label structure detail ("4×1 mi @ I · 3 min jog") instead of
// the type title. Single source of truth at lib/coach/workout-title.ts.
import { workoutTypeTitle } from '@/lib/coach/workout-title';

/**
 * 2026-06-04 · per-phase gradient for the .phgrid .phase cards.
 * Each stop is HAND-HARMONIZED with phaseColor() so the bright stop
 * of the card matches the ramp-bar color exactly (eye reads the
 * yellow bar + yellow card as the same phase identity).  Earlier
 * iteration pulled from PHASE[k].mesh and produced a mismatch
 * (ramp bar #FFCB47 yellow, card #F3AD38 → #C47812 amber) · David
 * flagged this as "colors should line up between bars and boxes."
 *
 * Each phase keeps a single hue across the gradient · saturation +
 * lightness drop from top-left to bottom-right.  CSS vars
 * --pg-1/2/3 are picked up by `.train2 .phase` in globals.css.
 */
function phaseMeshGradient(p: PhaseKey): React.CSSProperties {
  // light = exact ramp-bar color (matches phaseColor())
  // mid   = saturation + lightness drop, same hue
  // dark  = deeper still, same hue
  let light: string; let mid: string; let dark: string;
  if (p === 'build')         { light = '#FFCB47'; mid = '#D6A12B'; dark = '#9C7218'; }
  else if (p === 'peak')     { light = '#FF7733'; mid = '#D04525'; dark = '#9E2820'; }
  else if (p === 'taper')    { light = '#56E0B0'; mid = '#2DB386'; dark = '#1A8862'; }
  else if (p === 'race')     { light = '#FFCE8A'; mid = '#D89A5A'; dark = '#9E6B30'; }
  else if (p === 'base')     { light = '#5BD8D2'; mid = '#2BA8A4'; dark = '#1A7878'; }
  else if (p === 'maintenance') { light = '#88B8C8'; mid = '#5A8898'; dark = '#3A5868'; }
  else if (p === 'recovery')    { light = '#5DD0F0'; mid = '#2DA0C8'; dark = '#1A7090'; }
  else                       { light = '#FFCE8A'; mid = '#D89A5A'; dark = '#9E6B30'; }
  return {
    ['--pg-1' as string]: light,
    ['--pg-2' as string]: mid,
    ['--pg-3' as string]: dark,
  } as React.CSSProperties;
}

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
  // QUALITY + RACE-SPECIFIC are composePlan's authored race-prep labels ·
  // map to 'build' and 'peak' respectively for the brand phase palette.
  if (s.startsWith('quality')) return 'build';
  if (s.startsWith('race-specific') || s.startsWith('race specific')) return 'peak';
  if (s.startsWith('build')) return 'build';
  if (s.startsWith('peak')) return 'peak';
  if (s.startsWith('taper')) return 'taper';
  if (s.startsWith('race')) return 'race';
  // 2026-06-03 · Rules 12 + 13 · non-race-prep modes.
  if (s.startsWith('maintenance')) return 'maintenance';
  if (s.startsWith('recovery')) return 'recovery';
  return 'base';
}
function phaseColor(p: PhaseKey): string {
  // Brand effort palette: base ≈ teal, build ≈ amber, peak ≈ orange, taper ≈ green.
  // 2026-06-03 · brightened across the board so phase-colored text pops
  // against its themed mesh background instead of muddying out. Each
  // shade is a saturation + lightness bump from the prior muted version
  // (BUILD #E0A23A → #FFCB47 etc).
  if (p === 'base')  return '#5BD8D2';
  if (p === 'build') return '#FFCB47';
  // 2026-06-03 · PEAK was peach (#FF9866) · David flagged off-brand.
  // Brand orange (--race in globals) is #FF8847; using a slightly more
  // saturated cousin #FF7733 so PEAK reads as "peak intensity" and
  // stays distinct from the race-day peach #FFCE8A.
  if (p === 'peak')  return '#FF7733';
  if (p === 'taper') return '#56E0B0';
  if (p === 'maintenance') return '#88B8C8';
  if (p === 'recovery')    return '#5DD0F0';
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
  // 2026-06-03 · take goalRace so the breakdown grid shows distance-
  // aware focus copy. Was reading PHASE constants directly → marathon
  // copy on every plan.
  goalRace: import('../types').GoalRace | null,
): PhaseMeta[] {
  return phaseGroups(raceIdx, phases).map((g) => {
    const authored = phaseFocus(g.phase, goalRace);
    return {
      k: g.phase,
      name: authored.name,
      color: phaseColor(g.phase),
      desc: authored.focus,
      // 2026-06-03 · dropped "Wk N–M" weeksLabel · same rebuild-resets-
      // week-1 problem. The phase title carries enough position on its own.
      weeksLabel: '',
      vol: '', // filled in from miles below
    };
  });
}

export function TrainView({
  seed, onOpenDetail, onMeshChange, onOpenRun,
}: {
  seed: FaffSeed;
  onOpenDetail: (dayIdx: number) => void;
  onMeshChange: (mesh: Mesh | null) => void;
  onOpenRun?: (id: string) => void;
}) {
  const { nowIdx, raceIdx, miles, maxMi, phases: realPhases } = seed.season;
  const [focusIdx, setFocusIdx] = useState(nowIdx);
  const [planOpen, setPlanOpen] = useState(false);
  const [planTab, setPlanTab] = useState<'month' | 'weeks'>('month');

  const isRace = focusIdx === raceIdx;
  const curPhase = phaseOfWeek(focusIdx, raceIdx, realPhases);
  // 2026-06-03 · `curPhaseMeta` now blends the PHASE constant's mesh
  // (gradient color · stays in constants for design parity) with the
  // distance-aware name + focus from phaseFocus(). The old code read
  // `PHASE[curPhase].focus` directly · that string was hardcoded to
  // marathon copy ("where a sub-3 gets built", "Hold 6:51/mi at CIM")
  // and shipped on every runner's plan.
  const goal = seed.goalRace;
  const _phaseAuthored = phaseFocus(curPhase, goal);
  const curPhaseMeta = {
    ...PHASE[curPhase],
    name: _phaseAuthored.name,
    sub: _phaseAuthored.sub,
    focus: _phaseAuthored.focus,
  };
  const daysOut = (raceIdx - focusIdx) * 7;

  // Per-phase metadata + volume range (compute from miles in that span).
  // Uses REAL plan_phases when present; falls back to a proportional split
  // for legacy plans that didn't author the phases table.
  const phases = useMemo(() => {
    const meta = buildPhaseMeta(raceIdx, realPhases, goal);
    return meta.map((m) => {
      const grp = phaseGroups(raceIdx, realPhases).find((g) => g.phase === m.k);
      if (!grp) return m;
      const slice = miles.slice(grp.from, grp.to + 1).filter((mi) => mi > 0);
      const lo = slice.length ? Math.min(...slice) : 0;
      const hi = slice.length ? Math.max(...slice) : 0;
      const vol = slice.length ? (lo === hi ? `${lo} mi` : `${lo}–${hi} mi`) : '—';
      return { ...m, vol };
    });
  }, [raceIdx, miles, realPhases, goal]);

  // 2026-06-04 · the mesh-follows-focused-week effect is retired.  Train
  // joined Today + Targets + Activity on the neutral charcoal page mesh
  // (Shell.tsx · view === 'train' → MESH.targets) and the per-phase
  // color now lives on the .phgrid .phase cards as a gradient.  The
  // ramp-bar scrubbing still updates focusIdx (which still drives the
  // phgrid + the NOW pill etc.); it just no longer recolors the page.
  // Symptom this fixes · "train goes grey on refresh but then I think
  // gets overridden by the phase color" — yes: this useEffect was
  // firing curPhaseMeta.mesh into Shell after first paint, repainting
  // the charcoal mesh back to BUILD amber.
  useEffect(() => {
    onMeshChange(null);
    return () => onMeshChange(null);
  }, [onMeshChange]);

  // Key workouts pulled from real plan: pick the QUALITY day in each future
  // week + label by type. Done past weeks marked done; current week tagged NOW.
  // 2026-05-31: done rows also carry actual pace + influence (hit/miss vs
  // planned target) so the runner can see what each workout did.
  // 2026-05-31 (closed-loop): cross-reference seed.season.adaptations
  // (coach_intents.reason LIKE 'plan_adapt_%') so DONE workouts that
  // triggered a plan change AND future workouts that were modified both
  // surface a follow-on "→ Adapted" line.
  const milestones = useMemo(() => {
    /** 2026-06-01 · Mile.influence shape extended to carry the backend's
     *  trainingInfluence kinds (on_track / consistent / working /
     *  slipping / compromised) in addition to the legacy execution-
     *  derived kinds (hit / close / off). When pick.trainingInfluence
     *  is present we prefer it · backend's authored copy reads the
     *  workout's effect on race trajectory, not just execution
     *  mechanics. Backend brief: training-trajectory-and-adapt-dedup-
     *  landed.md · commit 2b7b4889. */
    type InfluenceKind =
      | 'hit' | 'close' | 'off'                  // legacy execution
      | 'on_track' | 'consistent' | 'working' | 'slipping' | 'compromised';
    type Mile = {
      wkLabel: string; dot: string; title: string; sub: string;
      state: 'DONE' | 'NOW' | 'KEY' | '' | 'RACE';
      raceRow?: boolean;
      date?: string;
      done?: boolean;
      influence?: { kind: InfluenceKind; copy: string } | null;
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
      trainingInfluence?: {
        kind: 'on_track' | 'consistent' | 'working' | 'slipping' | 'compromised';
        copy: string;
      } | null;
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
    // 2026-06-01 · drop superseded + override-marker rows per backend
    // dedup landed at 2b7b4889. supersededByOverride === true means a
    // later plan_adapt_overridden landed for the same workoutId; kind
    // === 'overridden' is the override-marker row itself (useful for a
    // future Overrides history view, not for the KEY WORKOUTS panel).
    const adapts = (seed.season.adaptations ?? []).filter(
      (a) => !a.supersededByOverride && a.kind !== 'overridden'
    );
    const verbForKind = (k: string) => k === 'reschedule' ? 'rescheduled' : k === 'downgrade' ? 'eased' : k === 'shave' ? 'shaved' : 'adjusted';
    seed.season.weekDays.forEach((days, i) => {
      if (i >= raceIdx) return;
      const isNow = i === nowIdx;
      const isPast = i < nowIdx;
      const isMid = i > nowIdx;
      const state: Mile['state'] = isPast ? 'DONE' : isNow ? 'NOW' : '';

      // Collect all key workouts for this week.
      //   · intervals + tempo: always key quality sessions.
      //   · long: only when the sub_label carries a specific finish-segment
      //     prescription: "@ M" (marathon pace) or "@ HM" (half-marathon pace).
      //     Plain long runs and D1-updated longs without a finish target are
      //     excluded. We check for "@ M" / "@ HM" specifically, not just "@",
      //     because D1 may have updated ALL long run sub_labels with a pace
      //     ("LONG · 14mi @ E") that would falsely match a plain "@" check.
      const keyDays = (days as DayShape[]).filter((d) => {
        if (d.type === 'intervals' || d.type === 'tempo') return true;
        return d.type === 'long' && (d.name.includes('@ M') || d.name.includes('@ HM'));
      }).sort((a, b) => {
        const rank = (t: string) => t === 'intervals' ? 0 : t === 'tempo' ? 1 : 2;
        return rank(a.type) - rank(b.type);
      });
      if (keyDays.length === 0) return;

      for (const pick of keyDays) {
        // 2026-06-03 · was "WK N" · same week-numbering problem as the
        // top-of-page pill. Switched to the workout's actual date which
        // never lies after a rebuild. pick.date can be undefined on
        // legacy fixture rows · formatDate() returns "·" on empty.
        const wkLabel = formatDate(pick.date ?? '').toUpperCase();
        const dot = PHASE_TYPE_COLOR[pick.type] ?? '#8A90A0';
        // 2026-06-03 · canonical title per David. Was: prefer pick.name
        // (the sub_label like "4×1 mi @ I · 3 min jog") with the type
        // string as fallback. Result: KEY WORKOUTS list rendered the
        // workout-structure detail instead of the type. Now: workoutTypeTitle
        // wins. The structure detail still lives in plan_workouts.sub_label
        // for surfaces that need it (e.g. the Today card body).
        const title = workoutTypeTitle(pick.type);
        const sub = `${pick.mi.toFixed(1)} mi${pick.paceSec ? ` @ ${Math.floor(pick.paceSec / 60)}:${String(Math.round(pick.paceSec % 60)).padStart(2, '0')}` : ''}`;
        // 2026-06-03 · dropped 'KEY' state per David: "they're all
        // literally in a card that says KEY WORKOUTS TO RACE." The card
        // title already establishes that every row is a key workout ·
        // tagging the last 3 rows again was redundant. NOW (today's
        // quality) and DONE (completed) stay because they're distinct
        // states the runner can act on.
        // Training trajectory: prefer backend-authored trainingInfluence
        // (commit 2b7b4889 · names the workout's effect on race trajectory,
        // not execution mechanics · 5 kinds: on_track / consistent /
        // working / slipping / compromised). Falls back to the legacy
        // client-side execution derivation only when backend hasn't
        // landed a trajectory signal for this row (e.g. composer set
        // null because data was incomplete, or non-quality type the
        // composer doesn't grade).
        let influence: Mile['influence'] = null;
        if (state === 'DONE' && pick.trainingInfluence) {
          influence = { kind: pick.trainingInfluence.kind, copy: pick.trainingInfluence.copy };
        } else if (state === 'DONE' && pick.paceSec) {
          // Legacy fallback · execution-mechanics signal when backend
          // didn't ship a trajectory call for this row. Same logic as
          // before · hit/close/off based on pace delta.
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
          }
          // Quality workout with no usable splits and no backend
          // trajectory · render nothing rather than the meaningless
          // "Logged" placeholder David called out.
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
      }
    });
    if (goal) {
      out.push({
        wkLabel: 'RACE', dot: '#FFCE8A',
        title: goal.name, sub: `${goal.goal ? goal.goal + ' · ' : ''}${formatDate(goal.date)}`,
        state: 'RACE', raceRow: true,
      });
    }
    // Rolling 9-row cap: filter to upcoming (not yet done) rows first so
    // past completed workouts don't fill the window. As workouts are marked
    // DONE they fall out and future ones roll in. Race row always stays.
    // Rationale: the old static slice(0,9) from plan week 1 caused July
    // intervals to never appear because 8+ past DONE weeks ate all 9 slots.
    const upcoming = out.filter(m => !m.done && !m.raceRow);
    const race = out.filter(m => m.raceRow);
    return [...upcoming, ...race].slice(0, 9);
  }, [seed.season.weekDays, nowIdx, raceIdx, goal]);

  // Phase-ramp metadata aligned with the REAL plan_phases (for the bottom
  // axis). 2026-06-03 · use phaseFocus(g.phase).name instead of the raw
  // `g.label` so the ramp's labels match the phase cards below
  // (buildPhaseMeta uses the same source). Before this, the chart said
  // QUALITY / RACE-SPECIFIC while the cards said BUILD / PEAK · same
  // phases, two naming systems, looked broken.
  const phaseAxis = useMemo(() => {
    const out: Array<{ key: PhaseKey; flex: number; color: string; label: string }> = [];
    phaseGroups(raceIdx, realPhases).forEach((g) => {
      const authored = phaseFocus(g.phase, goal);
      out.push({ key: g.phase, flex: g.to - g.from + 1, color: phaseColor(g.phase), label: authored.name });
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
      {/* Header · de-cluttered per designs/from Design agent/train-page
          (2026-06-01). Removed: .t-kicker (BASE PHASE · WEEK 5 + race
          name/location/date repeating downstream) and the .sline
          (BASE · WEEKS 1-6, duplicating phase info already in .t-ptitle
          and in the ramp axis). Each fact, phase / race / week / date,
          now appears once. */}
      <div className="t-htop">
        <div>
          <div className="t-eyebrow">
            {goal ? <>{goal.name.toUpperCase()} · <b>{goal.goal}</b></> : 'NO GOAL RACE SET'}
          </div>
          <div className="t-ptitle">{isRace ? 'RACE DAY' : (curPhaseMeta?.name ?? '—')}</div>
          <div className="t-focus">
            <span className="ftag">FOCUS</span>
            <span className="ftx">{curPhaseMeta?.focus ?? 'Active block.'}</span>
          </div>
          {/* 2026-06-03 · Rule 11 chip · horizon-aware long-run cap. Renders
              only when a future A/B race within 24 weeks raises the cap. */}
          {seed.season.horizonRaise ? (
            <div className="t-horizon-chip" style={{
              marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 999, fontSize: 11,
              fontFamily: 'Inter, -apple-system, sans-serif', letterSpacing: 0.6,
              // 2026-06-03 · was a faint peach outline (rgba(252,206,138,.12) bg,
              // peach border).  Against the same-hue themed-mesh card behind it
              // the chip lost legibility.  Fill with a dark backdrop so peach
              // text always reads.
              background: 'rgba(0, 0, 0, .55)', border: '1px solid rgba(0, 0, 0, .35)',
              color: '#FFCE8A',
            }}>
              <span style={{ fontWeight: 700 }}>LONG-RUN CAP · {seed.season.horizonRaise.toLongCapMi}mi</span>
              <span>
                setting up {seed.season.horizonRaise.race.name}
              </span>
            </div>
          ) : null}
        </div>
        <div className="t-status">
          <span className="t-wkpill">
            <span className="dot" style={{ background: phaseColor(curPhase), boxShadow: `0 0 8px ${phaseColor(curPhase)}` }} />
            {/* 2026-06-03 · dropped "WK N · " prefix. Plan rebuilds reset
                week_idx=0 to the current Monday, so a runner mid-block sees
                their training "rewind" to week 1 every regenerate. The
                NOW outline on the bar + the days-to-race countdown carry
                the position more honestly. */}
            {isRace ? 'RACE DAY' : `${miles[focusIdx]} MI · NOW`}
          </span>
          <span className="cd">
            {isRace ? <>Race day. It&rsquo;s here.</> : goal ? <><b>{daysOut}</b> days to {formatDate(goal.date)}</> : <><b>{daysOut}</b> days to go</>}
          </span>
        </div>
      </div>

      {/* Phase ramp */}
      <div className="ramp-wrap">
        <div className="ramp-head">
          {/* 2026-06-03 · dropped "{raceIdx}-WEEK BLOCK" prefix. The block
              length is whatever's left to race day after the most-recent
              rebuild · it doesn't carry the runner's full training arc
              forward. "Weekly volume to race day" is the honest framing. */}
          <span className="lbl">WEEKLY VOLUME · TO RACE DAY</span>
          <button className="ghostbtn" onClick={() => openPlan('month')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>
            FULL PLAN
          </button>
        </div>
        <div className="ramp">
          {miles.map((mi, i) => {
            // 2026-06-03 · skip the race-week index · phaseOfWeek(raceIdx)
            // returns 'race' (peach), and an explicit checkered race bar
            // is rendered below the map. Without this guard we got two
            // race bars (a peach one + a checkered one), and the phase
            // labels' flex sum didn't match the bar count.
            if (i === raceIdx) return null;
            const h = mi > 0 ? Math.round((mi / Math.max(maxMi, 1)) * 100) : 6;
            const ph = phaseOfWeek(i, raceIdx, realPhases);
            const isCur = i === focusIdx;
            const isPast = i < nowIdx;
            return (
              <div
                key={i}
                className={`bar${isCur ? ' cur' : ''}`}
                style={{ height: `${h}%`, background: phaseColor(ph), opacity: isPast && !isCur ? 0.62 : 1 }}
                title={`${mi} mi`}
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
        {/* 2026-06-03 · phase labels use grid with EXPLICIT column spans
            matching the bars' grid. .ramp has 12 bars with 11 gaps; if
            ramp-phases used flex with 4 labels and 3 gaps the total
            widths matched but the column positions drifted (different
            number of gaps = different unit widths). Grid with the same
            column template + each label spanning its phase's columns
            gives mathematical alignment. */}
        {(() => {
          const totalCols = phaseAxis.reduce((s, p) => s + p.flex, 0);
          let cursor = 1;
          return (
            <div className="ramp-phases" style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${totalCols}, 1fr)`,
              gap: 6,
            }}>
              {phaseAxis.map((p, i) => {
                const start = cursor;
                cursor += p.flex;
                // marker tint stays phase-colored via CSS var so
                // ::before reads the accent; text itself is white
                // for readability on the yellow/orange mesh.
                const style = {
                  gridColumn: `${start} / span ${p.flex}`,
                  '--pp-accent': p.color,
                } as React.CSSProperties;
                return (
                  <div key={i} className="pp" style={style}>
                    {p.label.toUpperCase()}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Lower dashboard */}
      <div className="lower">
        {/* Phase breakdown grid */}
        <div className="phgrid">
          {phases.map((p) => {
            const now = p.k === curPhase;
            return (
              <div
                className={`phase${now ? ' now' : ''}`}
                key={p.k}
                // 2026-06-04 · per-phase gradient · color identity now
                // lives in the card background (page mesh is charcoal).
                // .pnm switches to white in CSS since the gradient already
                // carries the phase hue.
                style={phaseMeshGradient(p.k)}
              >
                <span className="pbar" style={{ background: p.color }} />
                {now && <span className="nowtag">NOW</span>}
                {/* 2026-06-04 · title back in phase color (David: "try
                    putting just the title in the color · so PEAK, or
                    TAPER, etc").  Body of the card is dark glass now;
                    color identity lives in the .pbar top stripe + the
                    .pnm title, not in the bg. */}
                <div className="pnm" style={{ color: p.color }}>{p.name}</div>
                {/* 2026-06-03 · weeksLabel removed · was "Wk N–M" which
                    reset to wk 1 every rebuild. The phase title + position
                    on the bar ramp carries the same info honestly. */}
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
              {/* 2026-06-03 · dropped "· WK N" suffix. THIS WEEK is
                  unambiguous on its own; the rebuild-resets-week-1
                  problem made the WK count meaningless. */}
              <span className="ct">THIS WEEK</span>
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
                    {/* Type label + optional sub_label secondary line.
                        workoutTypeTitle gives the one-word chip (LONG,
                        TMPO, etc). d.name carries sub_label when the
                        plan-builder authored a structured prescription
                        ("LONG · 4mi @ M"). Show it as a small secondary
                        line only when it adds info beyond the type chip. */}
                    <span className="tnm">{workoutTypeTitle(d.type)}</span>
                    {d.name && d.name.toLowerCase() !== workoutTypeTitle(d.type).toLowerCase() ? (
                      <span style={{
                        fontSize: 9, fontWeight: 700, letterSpacing: '0.6px',
                        color: 'rgba(255,255,255,.55)', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120,
                        marginLeft: 6,
                      }}>{d.name}</span>
                    ) : null}
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

          {/* PROJECTION card · redesigned 2026-06-01 per
              designs/from Design agent/train-page README §4-6.
              · §4 What-closes-it folded directly into the panel (no
                inner bordered card) as .gap/.lever rows
              · §5 Projection bar replaced by a labeled SLOWER/FASTER
                axis with goal at center, today offset, and a chip on
                the segment
              · §6 Big projected time is solid white (was a gold
                gradient that fought the rest of the app)
              The richer gap-report content (confidence band,
              alternative ranges, plan risks) is intentionally NOT in
              this card per design · those have other surfaces if
              David wants them later. */}
          <div className="card proj">
            <div className="ch">
              <span className="ct">PROJECTION</span>
              <span className="cx">{goal ? `vs ${goal.goal}` : '—'}</span>
            </div>
            {goal?.projected ? (() => {
              // Bar positions · prefer numeric seconds from the
              // gap-report when available; fall back to parsing the
              // formatted strings. Schematic 50/50 when neither parses.
              const goalSec = seed.readinessBrief?.gapReport?.goalSec
                ?? parseClockTime(goal.goal) ?? 0;
              // 2026-06-04 · WATCHING state needs to position the
              // dot at the model's actual read · not at the goal.
              // The plan-trusts-itself doctrine returns
              // projectionSec=goalSec when status is on-track or
              // watching, which made the dot land at the GOAL tick
              // and the chip read "0 sec ahead" even though the
              // engine knew there were soft signals (same bug we
              // fixed on Targets). For watching, use the raw VDOT
              // projection to position the dot honestly while the
              // big headline number stays at the goal (= the plan
              // is still the path). For off-track, goal.projected
              // is already the VDOT-derived projection, so the
              // normal parse path works.
              const projSec = (goal.goalStatus === 'watching' && goal.vdotProjectionSec)
                ? goal.vdotProjectionSec
                : (seed.readinessBrief?.gapReport?.trajectorySec
                  ?? parseClockTime(goal.projected) ?? 0);
              const gapSec = (projSec && goalSec) ? projSec - goalSec : 0;
              // Bar offset · cap at 28% from center so the dot stays
              // visible at big deltas. Floor at 10% so a small gap is
              // still readably offset from the goal tick. Linear slope
              // of 2 amplifies small gaps for visibility · a 5% raw
              // gap maps to 10% offset, 14% raw saturates.
              const rawPct = goalSec > 0 ? Math.abs(gapSec) / goalSec * 100 : 0;
              const mag = rawPct === 0
                ? 0
                : Math.min(28, Math.max(10, rawPct * 2));
              const behind = gapSec > 0;
              const projLeftPct = mag === 0 ? 50 : (behind ? 50 - mag : 50 + mag);
              const segLeft = Math.min(50, projLeftPct);
              const segWidth = Math.abs(50 - projLeftPct);
              const chipLeft = (50 + projLeftPct) / 2;
              // Hide the TODAY label when proj sits close enough to
              // the goal tick that the "1:30:00" / "1:34:54" times
              // would visually intersect. The projected time is
              // already shown in the big pjbig number above + the
              // delta is in the chip · no information loss. The dot
              // still offsets, just without the redundant label.
              // David call 2026-06-01: "5 min behind · causing the
              // type to intersect."
              const hideProjLabel = mag > 0 && mag < 18;
              const levers = (goal.levers ?? []).slice(0, 3);
              const fallbackLines = !levers.length
                ? (seed.readinessBrief?.gapReport?.whatClosesIt ?? []).slice(0, 3)
                : [];

              const leverIcon = (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17L17 7M9 7h8v8" />
                </svg>
              );

              // 2026-06-04 · status-aware chip + sublabel · matches
              // the Targets headline fix · "0 sec ahead" was firing
              // for both on-track AND watching because chip read
              // goal.delta directly. Now: chip says "watching" in
              // watching state, falls through to goal.delta for
              // on-track/off-track.
              const isWatching = goal.goalStatus === 'watching';
              const chipLabel = isWatching ? 'watching' : goal.delta;
              const sublabel = isWatching
                ? `WATCHING · ${goal.goal} STILL IN PLAY`
                : 'PROJECTED FINISH TODAY';
              // Show the TODAY label using the model's read when
              // watching · so the runner can compare against the
              // goal tick. When on-track/off-track, goal.projected
              // is already the right number.
              const projLabelTime = isWatching && goal.vdotProjectionSec
                ? formatRaceTime(goal.vdotProjectionSec) ?? goal.projected
                : goal.projected;
              return (
                <>
                  <div className="pjbig amber">{goal.projected}</div>
                  <div className="pjlab">{sublabel}</div>
                  <div className="pjtrack">
                    <span className="pjzone slow" />
                    <span className="pjzone fast" />
                    {segWidth > 0 ? (
                      <span className="pjseg" style={{ left: `${segLeft}%`, width: `${segWidth}%` }} />
                    ) : null}
                    <span className="pjend left">SLOWER</span>
                    <span className="pjend right">FASTER</span>
                    {chipLabel && mag > 0 ? (
                      <span className="pjchip" style={{ left: `${chipLeft}%` }}>{chipLabel}</span>
                    ) : null}
                    <span className="pjtick goal" style={{ left: '50%' }} />
                    <span className="pjtick proj" style={{ left: `${projLeftPct}%` }} />
                    <span className="pjlbl" style={{ left: '50%' }}>GOAL<b>{goal.goal}</b></span>
                    {hideProjLabel ? null : (
                      <span className="pjlbl proj" style={{ left: `${projLeftPct}%` }}>TODAY<b>{projLabelTime}</b></span>
                    )}
                  </div>
                  {(levers.length > 0 || fallbackLines.length > 0) ? (
                    <div className="gap">
                      <div className="gap-lbl">WHAT CLOSES IT</div>
                      <div className="gap-list">
                        {levers.map((lv, i) => (
                          <div key={`l-${i}`} className="lever">
                            <span className="lv-ic">{leverIcon}</span>
                            <span className="lv-t">{lv.title}</span>
                          </div>
                        ))}
                        {fallbackLines.map((line, i) => (
                          <div key={`f-${i}`} className="lever">
                            <span className="lv-ic">{leverIcon}</span>
                            <span className="lv-t">{line}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              );
            })() : (
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
                        // Color encodes the trajectory signal:
                        //   green       · on_track / consistent / working / legacy hit
                        //   amber       · slipping / legacy close
                        //   orange-red  · legacy off
                        //   muted grey  · compromised (downgraded · not the runner's fault)
                        color:
                          m.influence.kind === 'on_track'   ? '#86efa0' :
                          m.influence.kind === 'consistent' ? '#86efa0' :
                          m.influence.kind === 'working'    ? '#48B3B5' :  // teal · sharper signal
                          m.influence.kind === 'slipping'   ? '#FFCE8A' :
                          m.influence.kind === 'compromised'? '#8A90A0' :
                          m.influence.kind === 'hit'        ? '#86efa0' :
                          m.influence.kind === 'close'      ? '#FFCE8A' :
                          /* off */                           '#FF9560',
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

          {/* Plan mutation history removed from TrainView 2026-06-01
              (David call). The full audit log lives on Profile via
              CoachActivityTimeline · the week strip + KEY WORKOUTS
              chips already surface per-day "was X" annotations at
              the point of decision. A buried dropdown at the bottom
              of Train was hidden chrome that read empty more often
              than not (see designs/briefs/coach-intents-empty-
              diagnostic.md for the underlying writer/reader
              mismatch that was hiding rows). */}
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
          onOpenRun={onOpenRun ?? (() => {})}
        />
      )}
    </div>
  );
}

/* ─────────────────────────  Full-plan modal  ───────────────────────── */

function PlanModal({
  tab, onSetTab, onClose, seed, focusIdx, setFocusIdx, onOpenRun,
}: {
  tab: 'month' | 'weeks';
  onSetTab: (t: 'month' | 'weeks') => void;
  onClose: () => void;
  seed: FaffSeed;
  focusIdx: number;
  setFocusIdx: (i: number) => void;
  onOpenRun: (id: string) => void;
}) {
  const goal = seed.goalRace;
  // 2026-06-01 · portal the modal to document.body so position:fixed
  // is anchored to the viewport rather than to .train2 inside the
  // sidebar-flanked .main column. Without the portal the scrim only
  // covered the post-sidebar area and the sheet centered in that
  // narrower box. createPortal is a no-op during SSR (returns null)
  // until mount completes.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;
  const modal = (
    <div className="train2-ov" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="train2-sheet">
        <div className="sheet-top">
          <div>
            <div className="stt">Full plan</div>
            <div className="sts">{goal ? `${goal.name} · ${seed.season.raceIdx} weeks · ${goal.goal}` : 'No goal race set'}</div>
          </div>
          <div className="seg">
            <button className={tab === 'month' ? 'on' : ''} onClick={() => onSetTab('month')}>Month</button>
            <button className={tab === 'weeks' ? 'on' : ''} onClick={() => onSetTab('weeks')}>Weeks</button>
          </div>
          <button className="sheet-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className={`sheet-body${tab === 'month' ? ' cal-mode' : ''}`}>
          {tab === 'month' ? <MonthCalendar seed={seed} onOpenRun={onOpenRun} /> : (
            <WeeksList seed={seed} focusIdx={focusIdx} onPick={(i) => { setFocusIdx(i); onClose(); }} />
          )}
        </div>
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}

function MonthCalendar({ seed, onOpenRun }: { seed: FaffSeed; onOpenRun: (id: string) => void }) {
  const goal = seed.goalRace;
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
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
  type PlanCell = {
    type: string;
    name: string;
    mi: number;
    paceSec: number | null;
    adaptation: NonNullable<typeof seed.season.weekDays>[number][number]['adaptation'] | null;
    activityId?: string | null;
    workoutSpec?: unknown;
  };
  const planMap = new Map<string, PlanCell>();
  // weekDays now carry `date` directly (fixed 2026-05-31 · the seed
  // builder was dropping training.weeks[i].days[j].date on the floor so
  // the calendar rendered every cell empty even though the plan had
  // workouts). Calendar now anchors each workout to its real slot.
  // 2026-06-01: planMap also carries adaptation so the cell can render
  // the small downgrade glyph + "was X" subline.
  // 2026-06-07: also carries activityId + workoutSpec for the day-detail panel.
  seed.season.weekDays.forEach((wkDays) => {
    wkDays.forEach((d) => {
      if (d.date) planMap.set(d.date, {
        type: d.type,
        name: d.name,
        mi: d.mi,
        paceSec: d.paceSec,
        adaptation: d.adaptation ?? null,
        activityId: d.activityId ?? null,
        workoutSpec: (d as { workoutSpec?: unknown }).workoutSpec ?? null,
      });
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
  // Parse goal date as local time (same fix as formatDate — ISO string
  // "2026-08-16" parsed via new Date() is UTC midnight which shifts back
  // one day in negative-UTC-offset timezones).
  const goalDateRaw = goal?.date ? (() => { const p = goal.date.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); })() : null;
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
  const selectedDay = selectedDate ? planMap.get(selectedDate) ?? null : null;

  return (
    <div className="cal-layout">
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
          const isSelected = selectedDate === iso;
          const clickable = !!(w && w.type !== 'rest') || !!isRace;
          const cls = `cell${isToday ? ' today' : ''}${isRace ? ' race' : ''}${past ? ' past' : ''}${isSelected ? ' cal-selected' : ''}${clickable ? ' cal-clickable' : ''}`;
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
            // Adaptation glyph + "was X" subline via shared
            // lib/adapt-text helper (David call 2026-06-01 · surface
            // all changes including distance, not just label flips).
            // Same detection used by TodayView's week strip so the
            // two surfaces stay consistent on what counts as adapted.
            const wasText = buildAdaptText(w.adaptation, {
              type: w.type,
              name: w.name,
              dist: w.mi,
              iso,
            });
            const adapted = !!wasText;
            body = (
              <div className="cwk">
                <span className="ctag" style={tint(c)}>
                  {workoutTypeTitle(w.type)}
                  {adapted ? (
                    <span
                      style={{
                        display: 'inline-block',
                        marginLeft: 5,
                        width: 6, height: 6,
                        borderRadius: '50%',
                        background: '#FFCE8A',
                        verticalAlign: 'middle',
                      }}
                    />
                  ) : null}
                </span>
                {/* Sub_label secondary line — shows structured prescription
                    ("LONG · 4mi @ M") when it's more specific than the type.
                    Same position as the adaptation "was X" subline. */}
                {w.name && w.name.toLowerCase() !== workoutTypeTitle(w.type).toLowerCase() ? (
                  <div style={{
                    marginTop: 2,
                    fontSize: 8, fontWeight: 700, letterSpacing: '0.5px',
                    color: 'rgba(255,255,255,.62)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {w.name}
                  </div>
                ) : null}
                <div className="cmeta">{w.mi.toFixed(1)}<small> mi{pace}</small></div>
                {wasText ? (
                  <div style={{
                    marginTop: 2,
                    fontSize: 8, fontWeight: 700, letterSpacing: '1px',
                    textTransform: 'uppercase',
                    color: 'rgba(255,206,138,0.72)',
                  }}>
                    {wasText}
                  </div>
                ) : null}
              </div>
            );
          }
          cells.push(
            <div
              key={`d-${dd}`}
              className={cls}
              id={isToday ? 'cal-today' : undefined}
              onClick={clickable ? () => setSelectedDate(iso === selectedDate ? null : iso) : undefined}
            >
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
      {selectedDate && selectedDay ? (
        <PlanDayPanel
          iso={selectedDate}
          day={selectedDay}
          onClose={() => setSelectedDate(null)}
          onOpenRun={onOpenRun}
        />
      ) : null}
    </div>
  );
}

/** Detail panel shown to the right of the calendar when a day is tapped. */
function PlanDayPanel({
  iso, day, onClose, onOpenRun,
}: {
  iso: string;
  day: {
    type: string; name: string; mi: number; paceSec: number | null;
    activityId?: string | null; workoutSpec?: unknown;
  };
  onClose: () => void;
  onOpenRun: (id: string) => void;
}) {
  const FONT_DISP = "var(--font-display, 'Oswald', sans-serif)";
  const c = PHASE_TYPE_COLOR[day.type] ?? '#8A90A0';
  const tint = { background: `${c}38`, color: c };
  const spec = (day.workoutSpec ?? null) as Record<string, unknown> | null;
  const paceStr = day.paceSec ? fmtPace(day.paceSec) : null;

  // Build segment rows from workout_spec when available.
  // Covers long (BASE/FINISH), tempo (WARMUP/TEMPO/COOLDOWN),
  // intervals, threshold, easy, progression.
  type Seg = { label: string; body: string; tail?: string };
  const segments: Seg[] = [];
  if (spec) {
    const kind = spec.kind as string | undefined;
    if (kind === 'long') {
      const lo = spec.pace_target_s_per_mi_lo as number | undefined;
      const hi = spec.pace_target_s_per_mi_hi as number | undefined;
      const fuelMi = spec.fuel_mi as number[] | undefined;
      const finishMi = spec.finish_mi as number | undefined;
      const finishPace = spec.finish_pace_s_per_mi as number | undefined;
      const finishLabel = spec.finish_label as string | undefined;
      if (finishMi && finishPace) {
        const baseMi = Math.max(0, day.mi - finishMi);
        segments.push({ label: 'BASE', body: `${baseMi.toFixed(1)} mi easy`, tail: lo && hi ? `${fmtPace(lo)}–${fmtPace(hi)}/mi` : 'Easy' });
        segments.push({ label: 'FINISH', body: `${finishMi.toFixed(1)} mi @ ${finishLabel ?? 'finish pace'}`, tail: `${fmtPace(finishPace)}/mi` });
      } else {
        if (lo && hi) segments.push({ label: 'PACE', body: 'Aerobic build', tail: `${fmtPace(lo)}–${fmtPace(hi)}/mi` });
        if (spec.hr_cap_bpm) segments.push({ label: 'HR CAP', body: 'Stay aerobic', tail: `${spec.hr_cap_bpm} bpm` });
        if (fuelMi && fuelMi.length > 0) segments.push({ label: 'FUEL', body: 'Gel · water · gel', tail: `mi ${fuelMi.join(' · ')}` });
      }
    } else if (kind === 'tempo' || kind === 'threshold') {
      const wu = spec.warmup_mi as number | undefined;
      const cd = spec.cooldown_mi as number | undefined;
      const repPace = spec.rep_pace_s_per_mi as number | undefined;
      const tempoPace = spec.tempo_pace_s_per_mi as number | undefined;
      const workPace = repPace ?? tempoPace;
      const workDist = spec.work_distance_mi as number | undefined;
      if (wu) segments.push({ label: 'WARMUP', body: `${wu.toFixed(1)} mi easy` });
      if (workDist && workPace) segments.push({ label: kind === 'tempo' ? 'TEMPO' : 'WORK', body: `${workDist.toFixed(1)} mi`, tail: `${fmtPace(workPace)}/mi` });
      else if (workPace) segments.push({ label: kind === 'tempo' ? 'TEMPO' : 'WORK', body: 'Work block', tail: `${fmtPace(workPace)}/mi` });
      if (cd) segments.push({ label: 'COOLDOWN', body: `${cd.toFixed(1)} mi easy` });
    } else if (kind === 'intervals') {
      const wu = spec.warmup_mi as number | undefined;
      const reps = spec.rep_count as number | undefined;
      const repPace = spec.rep_pace_s_per_mi as number | undefined;
      const recov = spec.recovery_mi as number | undefined;
      const cd = spec.cooldown_mi as number | undefined;
      if (wu) segments.push({ label: 'WARMUP', body: `${wu.toFixed(1)} mi easy` });
      if (reps && repPace) segments.push({ label: 'REPS', body: `${reps}×`, tail: `${fmtPace(repPace)}/mi` });
      if (recov) segments.push({ label: 'RECOVERY', body: `${recov.toFixed(1)} mi jog between` });
      if (cd) segments.push({ label: 'COOLDOWN', body: `${cd.toFixed(1)} mi easy` });
    } else if (kind === 'easy') {
      const lo = spec.pace_target_s_per_mi_lo as number | undefined;
      const hi = spec.pace_target_s_per_mi_hi as number | undefined;
      if (lo && hi) segments.push({ label: 'PACE', body: 'Easy · conversational', tail: `${fmtPace(lo)}–${fmtPace(hi)}/mi` });
    } else if (kind === 'progression') {
      const wu = spec.warmup_mi as number | undefined;
      const start = spec.prog_start_s_per_mi as number | undefined;
      const end = spec.prog_end_s_per_mi as number | undefined;
      const cd = spec.cooldown_mi as number | undefined;
      if (wu) segments.push({ label: 'WARMUP', body: `${wu.toFixed(1)} mi easy` });
      if (start && end) segments.push({ label: 'PROGRESSION', body: 'Build easy → tempo', tail: `${fmtPace(start)} → ${fmtPace(end)}` });
      if (cd) segments.push({ label: 'COOLDOWN', body: `${cd.toFixed(1)} mi easy` });
    }
  }

  const niceDate = (() => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  })();

  return (
    <div className="cal-detail">
      <div className="cal-detail-top">
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', marginBottom: 4 }}>{niceDate}</div>
          <span className="ctag" style={tint}>{workoutTypeTitle(day.type)}</span>
          {day.name && day.name.toLowerCase() !== workoutTypeTitle(day.type).toLowerCase() ? (
            <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.8)' }}>{day.name}</div>
          ) : null}
        </div>
        <button className="sheet-x" onClick={onClose} aria-label="Close day detail">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      {/* Distance + pace headline */}
      <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
        <div>
          <div style={{ fontFamily: FONT_DISP, fontSize: 28, fontWeight: 600, lineHeight: 1 }}>{day.mi.toFixed(1)}<small style={{ fontSize: 13, fontWeight: 400, marginLeft: 3, opacity: 0.6 }}>mi</small></div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,.45)', marginTop: 4 }}>DISTANCE</div>
        </div>
        {paceStr ? (
          <div>
            <div style={{ fontFamily: FONT_DISP, fontSize: 28, fontWeight: 600, lineHeight: 1 }}>{paceStr}<small style={{ fontSize: 13, fontWeight: 400, marginLeft: 3, opacity: 0.6 }}>/mi</small></div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,.45)', marginTop: 4 }}>TARGET PACE</div>
          </div>
        ) : null}
      </div>

      {/* Segment breakdown */}
      {segments.length > 0 ? (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {segments.map((seg, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,.05)' }}>
              <div>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.4, color: 'rgba(255,255,255,.42)', marginBottom: 3 }}>{seg.label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.88)' }}>{seg.body}</div>
              </div>
              {seg.tail ? <div style={{ fontSize: 13, fontWeight: 700, color: c, whiteSpace: 'nowrap' }}>{seg.tail}</div> : null}
            </div>
          ))}
        </div>
      ) : day.type !== 'rest' ? (
        <div style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,.45)' }}>
          {day.type === 'easy' || day.type === 'recovery' ? 'Easy aerobic run. Conversational pace throughout.' : 'See full plan for session detail.'}
        </div>
      ) : null}

      {/* View completed run button */}
      {day.activityId ? (
        <button
          onClick={() => onOpenRun(day.activityId!)}
          style={{
            marginTop: 20, width: '100%', padding: '11px 16px',
            background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.14)',
            borderRadius: 10, color: '#fff', fontSize: 13, fontWeight: 700,
            cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}
        >
          <span>View completed run</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      ) : null}
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
            <span className="wkey">{goal.name} · {goal.goal}</span>
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
  // Parse as LOCAL date, not UTC. new Date("2026-06-28") parses as UTC
  // midnight which in PDT (UTC-7) renders as Jun 27 — off by one.
  // Splitting and constructing with new Date(y, m-1, d) uses local time.
  const parts = iso.split('-').map(Number);
  if (parts.length < 3) return '·';
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

/** Parse "H:MM:SS" or "M:SS" clock string to total seconds.
 *  Returns null when the string isn't parseable · caller falls back
 *  to schematic positioning on the projection track. */
function parseClockTime(s: string): number | null {
  if (!s) return null;
  const parts = s.trim().split(':').map(x => parseInt(x, 10));
  if (parts.some(p => Number.isNaN(p))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}
