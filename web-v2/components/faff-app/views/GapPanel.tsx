'use client';

/**
 * GapPanel · "Closing the gap"
 *
 * Replaces the flat Projection Trend sparkline on Targets with the
 * design-agent's redesigned teaching panel. Honors the directional
 * call from designs/from Design agent/Targets page/Targets web/
 * designs/from Design agent/targets-redesign/rationale.md ·
 * "steady is the truth, here is what the gap is made of, here is
 * the cheapest way to close it."
 *
 * What it adds beyond the hero:
 *   · A truth headline that explains WHY the projection is steady
 *     (the model only re-rates on a real signal · stating that out
 *     loud turns a flat line into a fact).
 *   · A VDOT meta strip · current value, held duration, last move.
 *   · A 4-segment gap decomposition · Fitness / Conditions / Course /
 *     Execution. Each tappable for doctrine.
 *   · A hit list of levers · projected time + delta + controllability.
 *
 * Per-state behaviour:
 *   · 'steady'    · default · gap breakdown + hit list
 *   · 'cold'      · no projection · honest empty + "log a race result"
 *   · 'raceweek'  · daysAway ≤ 7 · A/B targets + race-morning cues
 *   · 'offtrack'  · projected > goal × 1.08 · honest gap leads with B
 *   · 'goalmoved' · profile carries a recent goal change · "bar moved"
 *
 * Data contracts (from seed.goalRace + seed.projectionTrend):
 *   · vdot + projectionSec from latest projectionTrend row.
 *   · goalSec / projectedSec from goalRace.{goal,projected}.
 *   · daysAway / location / name from goalRace.
 *   · status from composeStatus() thresholds (proj > goal×1.03 = watch,
 *     × 1.08 = off).
 *
 * No fake data · for chunks we can't compute today (heat-adjusted
 * conditions, course elevation impact, execution buffer), we use
 * doctrine-derived static fallbacks tagged by controllability per
 * Research/03 / course_library / Research/04. The Fitness chunk is
 * always real (predictRaceTime vs goalSec at the current VDOT).
 */

import { useEffect, useMemo, useState } from 'react';
import type { GoalRace } from '../types';
import { parseRaceTime } from '@/lib/training/vdot';
import { projectFitnessTrajectory } from '@/lib/training/fitness-trajectory';

interface GapPanelProps {
  goal: GoalRace;
  series: Array<{ date: string; projectionSec: number | null; vdot: number | null }>;
  /** 2026-06-09 · Phase 2 F1/F9 — provenance of the VDOT this panel hangs
   *  off. Same envelope as seed.health.vdotAnchor (Health staleness
   *  warning). The Targets page showed "VDOT 47.9" with no hint the anchor
   *  was a February race while every race since read 44-45. */
  anchor?: {
    vdot: number;
    anchorDateISO: string;
    anchorRaceName: string | null;
    ageDays: number;
    tier: 'fresh' | 'aging' | 'stale';
  } | null;
}

type SegKey = 'fitness' | 'conditions' | 'course' | 'execution';
type ControlTag = 'Trainable' | 'Partly' | 'Fixed';

interface GapSeg {
  key: SegKey;
  nm: string;
  sec: number;
  tag: ControlTag;
  doctrine: string;
  src: string;
}

interface Hit {
  icon: 'flag' | 'bolt' | 'clock' | 'shield' | 'spark';
  t: string;
  lvtag?: 'Trainable' | 'Logistics' | 'Smart';
  w: string;
  to: string;
  d: string;
  dKind: 'cut' | 'fixed';
}

type Status = { kind: 'good' | 'watch' | 'off' | 'info'; text: string };

const SWATCH: Record<SegKey, string> = {
  fitness: '#F3AD38',
  conditions: '#E88021',
  course: '#D6263C',
  execution: '#8A90A0',
};

/* ─────── helpers ─────── */
function parseClockToSec(s: string | null | undefined): number | null {
  // 2026-06-09 · race-killer F2 — delegate to the shared parser so every
  // surface disambiguates "1:30" (h:mm goal) vs "23:15" (m:ss finish) the
  // same way. This panel had its own fix since 2026-06-04 (David's QC:
  // fitness chip "92:48" from goalSec=90); same heuristic, now one copy.
  if (s === '·') return null;
  return parseRaceTime(s);
}
function fmtClock(sec: number | null): string {
  if (sec == null) return ' · ';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function fmtDelta(sec: number): string {
  const m = Math.floor(Math.abs(sec) / 60);
  const s = Math.abs(sec) % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/* ─────── per-state derivations ─────── */
function deriveStatus(projSec: number | null, goalSec: number | null): Status {
  if (projSec == null || goalSec == null) {
    return { kind: 'info', text: 'Estimating' };
  }
  const r = projSec / goalSec;
  if (r > 1.08) return { kind: 'off', text: 'Off track · honest gap' };
  if (r > 1.03) return { kind: 'watch', text: 'Watch · close it' };
  return { kind: 'good', text: 'On track' };
}

/**
 * Derive the gap segments. Fitness is always real (predicted vs goal
 * at the current VDOT). Conditions / Course / Execution are estimated
 * from doctrine until we have per-race adjusters available.
 *
 * Roughly:
 *   · Conditions ≈ 1:30 in summer (heat impact on race pace at goal HR)
 *   · Course ≈ 24s for rolling, ~0s for flat (course_library will own)
 *   · Execution ≈ 30s pacing buffer (Research/04)
 */
function deriveSegs(goalSec: number, projSec: number, goal: GoalRace): GapSeg[] {
  const totalGap = Math.max(0, projSec - goalSec);
  // 2026-05-31: Course + Conditions + Execution now read per-race seeds
  // when the backend has computed them; fall back to doctrine defaults
  // when null (cold start, stub course, foreign race outside climate
  // normals). See designs/briefs/targets-gap-panel-backend-brief.md §2.
  const FIXED_COURSE = goal.courseImpactSec != null
    ? Math.max(0, Math.round(goal.courseImpactSec))
    : 24;
  const courseHasReal = goal.courseImpactSec != null;
  // 2026-05-31 · Conditions chunk now reads goal.conditionsImpactSec
  // (Maughan model · forecast or climate normals). Falls back to 0
  // (neutral) when null — no data means no penalty assumed.
  const PARTLY_COND = goal.conditionsImpactSec != null
    ? Math.max(0, Math.round(goal.conditionsImpactSec))
    : 0;
  const conditionsHasReal = goal.conditionsImpactSec != null;
  // 2026-05-31 · Execution chunk reads goal.executionBufferSec
  // (CV across the runner's race-effort splits). Always populated
  // by the seed · 30s default when fewer than 2 typed runs.
  const TRAIN_EXEC = goal.executionBufferSec != null
    ? Math.max(0, Math.round(goal.executionBufferSec))
    : 30;
  const executionHasReal = goal.executionSource === 'observed';
  const baseline = FIXED_COURSE + PARTLY_COND + TRAIN_EXEC;
  const fitness = Math.max(0, totalGap - baseline);
  return [
    {
      key: 'fitness',
      nm: 'Fitness',
      sec: fitness,
      tag: 'Trainable',
      doctrine:
        fitness > 0
          ? `Your current VDOT projects ${fmtClock(projSec)}. ${fmtDelta(fitness)} of the gap is fitness · the only piece training moves. Each +1 VDOT shaves roughly 30 seconds at this distance.`
          : `Your projection is already at goal pace on a perfect day. Fitness is not the bottleneck right now · protect it.`,
      src: 'Daniels VDOT · Research/01 §pace-zones',
    },
    {
      key: 'conditions',
      nm: 'Conditions',
      sec: PARTLY_COND,
      tag: 'Partly',
      doctrine: conditionsHasReal
        ? conditionsDoctrineCopy(PARTLY_COND, goal)
        : `Heat above ~60°F costs 1–2% on pace. About ${fmtDelta(PARTLY_COND)} here against goal conditions. An earlier corral or a cooler race claws some back.`,
      src: conditionsHasReal
        ? `Research/06 · Maughan model · ${goal.conditionsSource ?? 'editorial'}`
        : 'Research/03 · heat-and-pace model',
    },
    {
      key: 'course',
      nm: 'Course',
      sec: FIXED_COURSE,
      tag: 'Fixed',
      doctrine: courseHasReal
        ? courseDoctrineCopy(FIXED_COURSE, goal)
        : `Rolling profiles cost ~${fmtDelta(FIXED_COURSE)} versus a flat reference. Plan for it, don't fight it. course_library editorial annotations will tighten this number once they ship per race.`,
      src: courseHasReal
        ? `course_library · ${goal.courseSource ?? 'editorial'} (${goal.courseElevGainFtPerMi ?? 0} ft/mi)`
        : 'course_library · editorial',
    },
    {
      key: 'execution',
      nm: 'Execution',
      sec: TRAIN_EXEC,
      tag: 'Trainable',
      doctrine: executionHasReal
        ? executionDoctrineCopy(TRAIN_EXEC)
        : `A ${fmtDelta(TRAIN_EXEC)} buffer for honest pacing. Go out 10s/mi too hot and the back half costs you double. The most winnable seconds on the list. (Your race-effort pacing pattern hasn't been observed yet · the chunk lights up with your own number after a few typed tempo/threshold runs.)`,
      src: executionHasReal
        ? 'Research/04 · observed pacing CV across your recent race efforts'
        : 'Research/04 · pacing discipline (doctrine default)',
    },
  ];
}

/** Doctrine copy when executionBufferSec is real (observed CV). */
function executionDoctrineCopy(sec: number): string {
  if (sec <= 15) {
    return `Your race-effort splits are tight · CV under 2%. ` +
      `A ${fmtDelta(sec)} buffer is enough · you don't blow up on pace ` +
      `discipline. Trust the plan.`;
  }
  if (sec <= 30) {
    return `Your race-effort splits are typical · CV around 3%. ` +
      `Plan for ${fmtDelta(sec)} of pacing buffer. Go out 10s/mi too ` +
      `hot and the back half costs you double.`;
  }
  return `Your race-effort splits drift · CV above 4%. A ${fmtDelta(sec)} ` +
    `buffer accounts for it · but this is the most winnable chunk on ` +
    `the list. Hold even mile-1 pace and you claim 30 seconds back.`;
}

/** Doctrine copy when conditionsImpactSec is real (per-race). */
function conditionsDoctrineCopy(sec: number, goal: GoalRace): string {
  const src = goal.conditionsSource === 'forecast'
    ? "the actual race-day forecast"
    : "typical race-morning climate for this location";
  let copy: string;
  if (sec === 0) {
    copy = `Based on ${src}, ${goal.name} sits in a neutral heat band · ` +
      `Conditions add no time at this distance. The day is not the bottleneck.`;
  } else if (sec <= 60) {
    copy = `Based on ${src}, expect Maughan to add about ${fmtDelta(sec)} · ` +
      `workable. Execute the day, don't fight it.`;
  } else {
    copy = `Based on ${src}, Maughan adds about ${fmtDelta(sec)} at ` +
      `${goal.name}'s expected temp. An earlier corral or cooler shoulder ` +
      `race claws some of that back.`;
  }
  if (goal.conditionsSafetyMessage) {
    copy += ` ${goal.conditionsSafetyMessage}`;
  }
  return copy;
}

/** Doctrine copy when courseImpactSec is real (per-race). */
function courseDoctrineCopy(sec: number, goal: GoalRace): string {
  const gpm = goal.courseElevGainFtPerMi ?? 0;
  if (sec === 0) {
    return `${goal.name}'s profile is a non-factor against the goal · the net ` +
      `gives back as much as the gross fatigue costs. Plan for an honest ` +
      `effort, not free time.`;
  }
  const grossDesc = gpm < 25 ? 'essentially flat'
                  : gpm < 60 ? 'rolling'
                  : gpm < 100 ? 'hilly'
                  : 'mountainous';
  return `${goal.name}'s profile (${gpm.toFixed(0)} ft/mi gross · ${grossDesc}) ` +
    `adds about ${fmtDelta(sec)} to a flat-reference projection. Daniels' ` +
    `correction · ~+10 s/mi per 100 ft/mi net climb, ~−7 s/mi per 100 ft/mi ` +
    `net drop, plus a small fatigue tax for the gross gain.`;
}

/**
 * Hit list mapper · prefer the per-runner levers computed by
 * lib/coach/projection-levers.ts (seeded onto goal.levers) when
 * available. Falls back to the legacy doctrine-static composition
 * when the seed enrichment didn't populate (cold start, error,
 * missing distance, etc.).
 */
function deriveHits(segs: GapSeg[], goalSec: number, projSec: number, goal: GoalRace): Hit[] {
  // 1. Per-runner levers from the seed (preferred).
  if (Array.isArray(goal.levers) && goal.levers.length > 0) {
    return goal.levers.slice(0, 3).map(lv => ({
      icon: lv.icon,
      t: `<b>${escapeHtml(lv.title)}</b>`,
      lvtag: lv.controllability,
      w: lv.detail,
      to: lv.projectedTime,
      d: lv.deltaSec < 0
        ? `−${fmtDelta(Math.abs(lv.deltaSec))}`
        : lv.deltaSec > 0
          ? `+${fmtDelta(lv.deltaSec)}`
          : 'at goal',
      dKind: lv.deltaSec <= 0 ? 'cut' : 'fixed',
    }));
  }

  // 2. Legacy doctrine fallback · kept for the cold path.
  const fitness = segs.find((s) => s.key === 'fitness')?.sec ?? 0;
  const cond = segs.find((s) => s.key === 'conditions')?.sec ?? 0;
  const out: Hit[] = [];
  if (fitness >= 60) {
    out.push({
      icon: 'flag',
      t: 'Drop a <b>tune-up race</b>',
      lvtag: 'Trainable',
      w: 'A confirmed result re-rates your VDOT and tightens this projection overnight.',
      to: fmtClock(Math.max(goalSec, projSec - Math.round(fitness * 0.5))),
      d: `−${fmtDelta(Math.round(fitness * 0.5))}`,
      dKind: 'cut',
    });
    out.push({
      icon: 'bolt',
      t: '<b>Threshold block</b> · 3 weeks of cruise intervals',
      lvtag: 'Trainable',
      w: 'T-pace work consolidates the VDOT you already have. Lowest race wear.',
      to: fmtClock(Math.max(goalSec, projSec - Math.round(fitness * 0.3))),
      d: `−${fmtDelta(Math.round(fitness * 0.3))}`,
      dKind: 'cut',
    });
  } else if (fitness > 0) {
    out.push({
      icon: 'shield',
      t: '<b>Hold the fitness</b> · no new PRs needed',
      lvtag: 'Trainable',
      w: `You only owe ${fmtDelta(fitness)} of fitness. Bank freshness instead of chasing it.`,
      to: fmtClock(goalSec + fitness),
      d: 'at goal',
      dKind: 'cut',
    });
  }
  if (cond >= 30) {
    out.push({
      icon: 'clock',
      t: 'Take the <b>cooler corral</b>',
      lvtag: 'Logistics',
      w: 'Starting in cooler air closes more than training does in the final weeks.',
      to: fmtClock(Math.max(goalSec, projSec - Math.round(cond * 0.45))),
      d: `−${fmtDelta(Math.round(cond * 0.45))}`,
      dKind: 'cut',
    });
  }
  return out.slice(0, 3);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' : '&#39;'
  );
}

/* ─────── icons ─────── */
function Icon({ kind }: { kind: Hit['icon'] }) {
  const paths: Record<Hit['icon'], string> = {
    flag: 'M4 22V4M4 4h13l-2.5 4L17 12H4',
    bolt: 'M13 2L3 14h9l-1 8 10-12h-9z',
    clock: '',
    shield: 'M12 21s-7-4.6-7-9.6V5l7-2 7 2v6.4C19 16.4 12 21 12 21z',
    spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2',
  };
  if (kind === 'clock') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4l3 2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[kind]} />
    </svg>
  );
}

/* ─────── the panel ─────── */
export function GapPanel({ goal, series, anchor }: GapPanelProps) {
  const goalSec = useMemo(() => parseClockToSec(goal.goal), [goal.goal]);
  const projSec = useMemo(
    () => goal.vdotProjectionSec ?? null,
    [goal.vdotProjectionSec],
  );
  const latest = useMemo(() => {
    const pts = series.filter((s) => s.projectionSec != null);
    return pts.length > 0 ? pts[pts.length - 1] : null;
  }, [series]);
  const heldDays = useMemo(() => {
    if (!series.length) return 0;
    const ptsWithProj = series.filter((s) => s.projectionSec != null);
    if (ptsWithProj.length < 2) return 0;
    const last = ptsWithProj[ptsWithProj.length - 1];
    // Walk backward looking for the first row that differs by ≥ 5s
    for (let i = ptsWithProj.length - 2; i >= 0; i--) {
      const p = ptsWithProj[i];
      if (p.projectionSec != null && last.projectionSec != null && Math.abs(p.projectionSec - last.projectionSec) >= 5) {
        const d0 = new Date(p.date).getTime();
        const d1 = new Date(last.date).getTime();
        if (Number.isFinite(d0) && Number.isFinite(d1)) {
          return Math.round((d1 - d0) / 86400000);
        }
      }
    }
    // All flat across the series
    const d0 = new Date(ptsWithProj[0].date).getTime();
    const d1 = new Date(last.date).getTime();
    if (Number.isFinite(d0) && Number.isFinite(d1)) {
      return Math.round((d1 - d0) / 86400000);
    }
    return 0;
  }, [series]);

  // 2026-06-11 · trajectory trend · the projected race-day time for each day of
  // VDOT history, recomputed at read-time from that day's stored VDOT + the
  // runway it had left. With a flat VDOT it drifts UP toward current fitness as
  // the runway closes (the honest "the window is closing" signal); a real
  // fitness gain pulls it back toward goal. Bounded by the plan ceiling, so it
  // never projects past the goal.
  const trajSeries = useMemo(() => {
    const t = goal.trajectory;
    const dist = goal.distanceMi;
    if (!t || goalSec == null || !dist || !goal.date) return [] as Array<{ date: string; sec: number }>;
    const raceMs = new Date(goal.date + 'T12:00:00Z').getTime();
    if (!Number.isFinite(raceMs)) return [];
    const out: Array<{ date: string; sec: number }> = [];
    for (const pt of series) {
      if (pt.vdot == null) continue;
      const ptMs = new Date(pt.date + 'T12:00:00Z').getTime();
      if (!Number.isFinite(ptMs)) continue;
      const weeksToRace = (raceMs - ptMs) / (7 * 86400000);
      if (weeksToRace < 0) continue;
      const proj = projectFitnessTrajectory({
        currentVdot: pt.vdot, goalSec, raceDistanceMi: dist, weeksToRace,
        executionQuality: t.executionQuality, plannedTargetVdot: t.plannedTargetVdot,
      });
      if (proj?.projectedSec != null) out.push({ date: pt.date, sec: proj.projectedSec });
    }
    return out;
  }, [series, goal, goalSec]);

  // Resolve which mode we're in. Race-week beats off-track beats steady.
  const mode: 'cold' | 'raceweek' | 'offtrack' | 'steady' = (() => {
    if (projSec == null) return 'cold';
    if (goal.daysAway >= 0 && goal.daysAway <= 7) return 'raceweek';
    if (goalSec != null && projSec / goalSec > 1.08) return 'offtrack';
    return 'steady';
  })();

  const status = deriveStatus(projSec, goalSec);
  const segs = useMemo(() => {
    if (goalSec == null || projSec == null) return [];
    return deriveSegs(goalSec, projSec, goal);
  }, [goalSec, projSec, goal]);
  const totalGapSec = useMemo(
    () => segs.reduce((acc, s) => acc + s.sec, 0),
    [segs],
  );
  const hits = useMemo(() => {
    if (goalSec == null || projSec == null) return [];
    return deriveHits(segs, goalSec, projSec, goal);
  }, [segs, goalSec, projSec, goal]);

  const [openSeg, setOpenSeg] = useState<number | null>(null);
  const toggleSeg = (i: number) => setOpenSeg((cur) => (cur === i ? null : i));

  // Reset doctrine drawer when the gap recomputes (avoid sticking on a
  // stale segment after VDOT moves).
  useEffect(() => { setOpenSeg(null); }, [goalSec, projSec, mode]);

  /* ─────── cold start ─────── */
  if (mode === 'cold') {
    return (
      <div className="fa-gappanel">
        <div className="pad">
          <div className="phead">
            <div className="eyebrow">Closing the gap</div>
            <span className={`statuschip ${status.kind}`}><i className="dot" />{status.text}</span>
          </div>
          <div className="truth">
            <div className="hl">We can&apos;t draw your gap yet · and we won&apos;t fake one.</div>
            <div className="sub">A projection needs a benchmark effort to anchor your VDOT. <b>One race result or a few weeks of quality runs unlocks the gap breakdown.</b></div>
          </div>
          <div className="vmeta">
            {latest?.vdot ? <span className="pill">VDOT <b>~{latest.vdot.toFixed(1)}</b></span> : null}
            <span className="pill">confidence <b>low</b></span>
          </div>
          <div className="coldempty">
            <span className="ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" />
              </svg>
            </span>
            <div className="t">Log a recent race or give Faff <b>about two weeks</b> of quality runs and the gap breakdown will appear here.</div>
            <a className="cta" href="/races">
              Log a race result
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </a>
          </div>
        </div>
      </div>
    );
  }

  /* ─────── race week ─────── */
  if (mode === 'raceweek') {
    const aTarget = goal.goal;
    const bTargetSec = goalSec ? goalSec + Math.round(goalSec * 0.033) : null; // B = A + ~3.3%
    const bTarget = bTargetSec != null ? fmtClock(bTargetSec) : '·';
    const aPace = goalSec && goal.distanceMi ? paceLabel(goalSec, goal.distanceMi) : 'goal pace';
    const bPace = bTargetSec != null && goal.distanceMi ? paceLabel(bTargetSec, goal.distanceMi) : 'safe pace';
    return (
      <div className="fa-gappanel">
        <div className="pad">
          <div className="phead">
            <div className="eyebrow">Race week · {goal.daysAway} day{goal.daysAway === 1 ? '' : 's'} out</div>
            <span className={`statuschip ${status.kind}`}><i className="dot" />Tapering</span>
          </div>
          <div className="truth">
            <div className="hl">The work is done. The gap <em>can&apos;t move</em> now.</div>
            <div className="sub">Nothing you do this week changes your fitness · only your freshness. The projection stops mattering. <b>Lock the plan: even pacing, fuel, sleep.</b></div>
          </div>
          <div className="abtarget" style={{ marginTop: 20 }}>
            <div className="t a"><span className="lbl">A · the goal</span><span className="v">{aTarget}</span><span className="p">{aPace} · if the day is cool and you feel it</span></div>
            <div className="t b"><span className="lbl">B · safe</span><span className="v">{bTarget}</span><span className="p">{bPace} · the line that still makes this a win</span></div>
          </div>
        </div>
        <div className="div" />
        <div className="pad">
          <div className="gaphd" style={{ marginBottom: 6 }}><span className="l">Race-morning focus</span></div>
          <div className="cue"><span className="n">1</span><span className="x">Bank <b>nothing</b> in the first 5K. Goal pace should feel almost too easy early.</span></div>
          <div className="cue"><span className="n">2</span><span className="x">Hold your <b>B-line</b> through halfway. Move to A only if the middle miles feel honest.</span></div>
          <div className="cue"><span className="n">3</span><span className="x">{goal.conditionsSafetyMessage ?? 'Take gels early and on the clock. Heat is the variable, not your legs.'}</span></div>
        </div>
      </div>
    );
  }

  /* ─────── steady / offtrack ─────── */
  const isOff = mode === 'offtrack';
  // 2026-06-11 · the goal-seeking trajectory leads when present. It supersedes
  // the old frozen-snapshot copy ("fitness held its mark") and the drift-binary
  // status: a runner can be drift-flagged "off track" yet projecting 40s off
  // goal on a perfect-execution trajectory — the trajectory is the honest read.
  const traj = goal.trajectory ?? null;
  const goalLabel = goal.goal;
  const raceDateLabel = (() => {
    const d = goal.date ? new Date(goal.date + 'T12:00:00Z') : null;
    if (!d || isNaN(d.getTime())) return 'Race day';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  })();

  let eyebrow = isOff ? 'The math is honest' : 'Holding steady';
  let truthHl: string;
  let truthSub: string;
  if (traj) {
    eyebrow = 'On the path';
    if (traj.aheadOfGoal) {
      truthHl = `<em>Ahead of ${goalLabel}</em> · tracking to beat it.`;
      truthSub = `Executing the plan, you project to <b>${fmtClock(traj.projectedSec ?? 0)}</b> by race day · about <b>${fmtDelta(Math.abs(traj.gapSec ?? 0))} faster</b> than goal. Your recent quality work is landing ahead of plan. Confirm it with a tune-up, or commit to the faster goal below.`;
    } else if (traj.reachable) {
      truthHl = `On track for <em>${goalLabel}</em>.`;
      truthSub = `Executing the plan, you project to <b>${fmtClock(traj.projectedSec ?? 0)}</b> by race day. Keep doing the work · the trajectory holds.`;
    } else if (traj.planBuiltForGoal === false) {
      truthHl = `Your plan tops out short of <em>${goalLabel}</em>.`;
      truthSub = `Executed clean it still projects <b>${fmtClock(traj.projectedSec ?? 0)}</b>. The fix is a more aggressive plan, not a harder you · the peak quality work needs to be faster.`;
    } else {
      const execWord = traj.executionQuality >= 0.9
        ? 'You\'re nailing your sessions'
        : traj.executionQuality >= 0.7 ? 'You\'re hitting most of your sessions' : 'Some sessions are slipping';
      truthHl = `<em>${fmtDelta(traj.gapSec ?? 0)}</em> from ${goalLabel} on this trajectory.`;
      truthSub = `${execWord}, and the plan is built for it · the build closes the last <b>${fmtDelta(traj.gapSec ?? 0)}</b>, about <b>+${traj.rateShortfallPerWeek}/wk</b> more fitness than you\'re on pace for. Within reach.`;
    }
  } else {
    truthHl = isOff
      ? `${goal.goal.replace(':00', '')} is a <em>stretch</em> from where you are.`
      : `Your fitness ${heldDays >= 14 ? `hasn't moved in <em>${heldDays} days</em>` : `held its mark this week`}. That's expected, not a stall.`;
    truthSub = isOff
      ? `The projection ${fmtClock(projSec ?? 0)} is a real gap, not an off day. <b>${goal.daysAway} days can close part of it</b> · setting a B-target keeps race day a win instead of a referendum.`
      : `The projection is deterministic · it only re-rates when a race or a breakthrough session beats your current estimate. It will not drift on its own. <b>Next test point: any quality workout that beats it, or the race.</b>`;
  }
  const statusChipKind = traj ? ((traj.aheadOfGoal || traj.reachable) ? 'good' : 'watch') : status.kind;
  const statusChipText = traj
    ? (traj.aheadOfGoal ? `${fmtDelta(Math.abs(traj.gapSec ?? 0))} ahead`
      : traj.reachable ? 'On track'
      : `${fmtDelta(traj.gapSec ?? 0)} to find`)
    : status.text;

  return (
    <div className="fa-gappanel">
      <div className="pad">
        <div className="phead">
          <div className="eyebrow">{eyebrow}</div>
          <span className={`statuschip ${statusChipKind}`}><i className="dot" />{statusChipText}</span>
        </div>
        <div className="truth">
          <div className="hl" dangerouslySetInnerHTML={{ __html: truthHl }} />
          <div className="sub" dangerouslySetInnerHTML={{ __html: truthSub }} />
        </div>
        {traj ? <TrajectoryHero t={traj} raceDateLabel={raceDateLabel} /> : null}
        {traj && trajSeries.length >= 3 ? <TrajectorySparkline series={trajSeries} goalSec={goalSec} /> : null}
        {traj && traj.planUnderBuilt ? <RebuildDoor slug={goal.slug} projectedSec={traj.projectedSec} goalSec={traj.goalSec} /> : null}
        {/* 2026-06-11 · one fitness line · David's strip-down. The chip pile
            (held / gap / re-rates), the 4-part gap breakdown, and the hit list
            are cut — the trajectory hero + sparkline already say where you are,
            where you're headed, and what moves it. Keep only current fitness +
            how fresh the anchor is. */}
        <div className="vmeta">
          {latest?.vdot ? <span className="pill">VDOT <b>{latest.vdot.toFixed(1)}</b></span> : null}
          {anchor ? (
            <span
              className="pill"
              title={anchor.tier === 'stale'
                ? 'Past the 120-day confidence window · a tune-up race or time trial would re-rate it.'
                : 'The race this fitness is read from.'}
              style={anchor.tier === 'stale' ? { color: '#F3AD38' } : undefined}
            >
              from <b>{anchor.anchorRaceName ?? `${anchor.anchorDateISO.slice(0, 10)} effort`} · {anchor.ageDays}d{anchor.tier === 'stale' ? ' · aging' : ''}</b>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ─────── trajectory hero · today → projected race-day → goal ─────── */
function TrajectoryHero({ t, raceDateLabel }: {
  t: NonNullable<GoalRace['trajectory']>;
  raceDateLabel: string;
}) {
  // Green when the trajectory reaches the goal, gold when it falls short.
  const projTone = t.reachable ? '#46B97E' : '#F3AD38';
  const node = (label: string, value: string, hero: boolean, tone: string) => (
    <div style={{ textAlign: 'center', flex: '1 1 0', minWidth: 0 }}>
      <div style={{
        fontSize: 9.5, letterSpacing: '.09em', textTransform: 'uppercase',
        color: 'rgba(255,255,255,.42)', marginBottom: 4, whiteSpace: 'nowrap',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-oswald, var(--font-display, inherit))', fontWeight: 600,
        fontSize: hero ? 27 : 19, lineHeight: 1, color: tone, fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  );
  const arrow = (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="rgba(255,255,255,.28)"
         strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: '0 0 auto' }}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      padding: '15px 14px', borderRadius: 14, marginTop: 16,
      background: 'rgba(255,255,255,.035)', border: '1px solid rgba(255,255,255,.07)',
    }}>
      {node('Today', t.currentSec != null ? fmtClock(t.currentSec) : '—', false, 'rgba(255,255,255,.62)')}
      {arrow}
      {node(raceDateLabel, t.projectedSec != null ? fmtClock(t.projectedSec) : '—', true, projTone)}
      {arrow}
      {node('Goal', fmtClock(t.goalSec), false, 'rgba(255,255,255,.92)')}
    </div>
  );
}

/* ─────── the upgrade door · set a faster goal + rebuild (Phase 3) ───────
 * Shows only when the trajectory has passed what the plan trains for
 * (planUnderBuilt). Routes to the existing PATCH /api/race flow, which updates
 * the goal AND auto-rebuilds the plan in one transaction. Deliberate (confirm
 * gate) — a door the runner walks through, not a nag. */
function RebuildDoor({ slug, projectedSec, goalSec }: {
  slug: string; projectedSec: number | null; goalSec: number;
}) {
  // A slightly conservative target: the projection rounded UP to the nearest
  // 30s — never promise faster than the trajectory actually shows.
  const suggestSec = projectedSec != null && projectedSec < goalSec
    ? Math.ceil(projectedSec / 30) * 30
    : goalSec;
  const fmtHMS = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.round(s % 60);
    return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  };
  const onRebuild = async () => {
    if (!window.confirm(`Set ${fmtClock(suggestSec)} as your goal and rebuild the plan around it? Your current plan will be replaced.`)) return;
    try {
      const res = await fetch('/api/race', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, goal: fmtHMS(suggestSec) }),
      });
      if (res.ok) window.location.reload();
      else window.alert('Could not rebuild the plan. Try setting the goal from the race page.');
    } catch { window.alert('Could not rebuild the plan. Try setting the goal from the race page.'); }
  };
  return (
    <div style={{
      marginTop: 14, padding: '12px 14px', borderRadius: 12,
      background: 'rgba(243,173,56,.07)', border: '1px solid rgba(243,173,56,.22)',
    }}>
      <div style={{ fontSize: 12, lineHeight: 1.45, color: 'rgba(255,255,255,.66)', marginBottom: 9 }}>
        Your trajectory has passed what this plan trains for. Confirm it with a tune-up, or commit to the faster goal and rebuild the block around it.
      </div>
      <button onClick={onRebuild} style={{
        fontFamily: 'var(--font-oswald, var(--font-display, inherit))', fontWeight: 600,
        fontSize: 12.5, letterSpacing: '.04em', textTransform: 'uppercase',
        color: '#1a1205', background: '#F3AD38', border: 'none', borderRadius: 8,
        padding: '8px 13px', cursor: 'pointer',
      }}>
        Set {fmtClock(suggestSec)} goal · rebuild plan
      </button>
    </div>
  );
}

/* ─────── trajectory trend sparkline · projected race-day time over history ─────── */
function TrajectorySparkline({ series, goalSec }: {
  series: Array<{ date: string; sec: number }>;
  goalSec: number | null;
}) {
  if (series.length < 3 || goalSec == null) return null;
  const W = 320, H = 58, padX = 5, padTop = 9, padBot = 7;
  const secs = series.map((s) => s.sec);
  const yMin = Math.min(...secs, goalSec);
  const yMax = Math.max(...secs, goalSec);
  const range = Math.max(1, yMax - yMin);
  const x = (i: number) => padX + (i / (series.length - 1)) * (W - 2 * padX);
  const y = (sec: number) => padTop + ((sec - yMin) / range) * (H - padTop - padBot);
  const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.sec).toFixed(1)}`).join(' ');
  const goalY = y(goalSec);
  const last = series[series.length - 1];
  // green when the projection is at/under goal, gold when above.
  const tone = last.sec <= goalSec + 1 ? '#46B97E' : '#F3AD38';
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
        <span style={{ fontSize: 9.5, letterSpacing: '.09em', textTransform: 'uppercase', color: 'rgba(255,255,255,.42)' }}>
          Projected race time · trend
        </span>
        <span style={{ fontSize: 9.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,.32)' }}>
          goal {fmtClock(goalSec)}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
        <line x1={padX} y1={goalY} x2={W - padX} y2={goalY} stroke="rgba(255,255,255,.20)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <polyline points={pts} fill="none" stroke={tone} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(series.length - 1)} cy={y(last.sec)} r="2.6" fill={tone} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function paceLabel(totalSec: number, distanceMi: number): string {
  const perMi = totalSec / Math.max(distanceMi, 0.01);
  const m = Math.floor(perMi / 60);
  const s = Math.round(perMi % 60);
  return `${m}:${s < 10 ? '0' : ''}${s} /mi`;
}
