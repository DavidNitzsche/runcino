'use client';

/**
 * RaceRetrospective — the post-race story for /races/[slug] (past races).
 *
 * Beats, in order:
 *   1. THE RACE STORY · mile-by-mile SVG — actual pace stepped over the
 *      course-phase bands (authored labels: "Point Loma Climb", "The Drop"),
 *      target-pace plan dashed, HR trace + elevation shading when present.
 *      Under it, the phase table: name · target · actual · delta.
 *   2. WHAT IT MEANS · VDOT from this race, projection before → after,
 *      what it predicts for the next A race vs that race's goal. Coach
 *      voice: short, direct, numbers first.
 *   3. RACE LOG · the notes/manual-entry form, collapsed under the result
 *      instead of being the whole page.
 *
 * Data honesty (CLAUDE.md race-data lock): everything renders from the
 * server-built RaceRetro, which reads races.actual_result first; watch
 * splits and watch-provisional finishes are always captioned as such.
 */
import { useState } from 'react';
import type { RaceRetro, RetroMile, RetroPhase } from '@/lib/race/retrospective';
import { RaceRetrospectiveForm } from './RaceRetrospectiveForm';

const STATUS_COLOR: Record<string, string> = {
  on: '#3EBD41',    // --green · within tolerance
  fast: '#27B4E0',  // --dist · faster than target (info, not praise-spam)
  slow: '#F3AD38',  // --goal · slower than target (attention, not shame)
};

function fmtClock(sec: number | null | undefined): string {
  if (sec == null || sec <= 0) return '·';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

function fmtPaceShort(sPerMi: number): string {
  const s = Math.round(sPerMi);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtGap(sec: number): string {
  const a = Math.abs(Math.round(sec));
  const m = Math.floor(a / 60);
  const s = a % 60;
  return m >= 60
    ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** "a 4:12 gap" vs "an 11:53 gap" — the article follows the spoken leading
 *  number (8, 11, 18, 80-89 open on a vowel sound). */
function gapArticle(display: string): string {
  const lead = display.split(':')[0];
  const n = parseInt(lead, 10);
  const vowelStart = n === 8 || n === 11 || n === 18 || (n >= 80 && n <= 89);
  return vowelStart ? 'An' : 'A';
}

export function RaceRetrospective({
  slug,
  retro,
  formExisting,
}: {
  slug: string;
  retro: RaceRetro | null;
  formExisting: {
    finishTime?: string | null;
    pb?: boolean | null;
    avgHrBpm?: number | null;
    retroFelt?: string | null;
    retroExecution?: string | null;
    retroNotes?: string | null;
  };
}) {
  const hasStory = retro != null && (retro.miles.length >= 2 || retro.phases.length > 0);
  const hasResult = retro?.finishS != null;
  // Form starts collapsed once a result exists; open when the race still
  // needs its finish logged.
  const [formOpen, setFormOpen] = useState(!hasResult);

  return (
    <>
      {hasStory && retro && (
        <div className="band">
          <div className="rp-sec">
            THE RACE STORY
            <span className="rp-secr">
              {retro.miles.length >= 2
                ? (retro.milesSource === 'watch' ? 'watch splits' : 'mile splits') + (retro.phases.length > 0 ? ' vs the plan' : '')
                : 'the course plan'}
            </span>
          </div>
          <div className="rp-panel">
            {retro.miles.length >= 2 && <StoryChart retro={retro} />}
            {retro.phases.length > 0 && <PhaseTable retro={retro} />}
          </div>
        </div>
      )}

      {hasResult && retro && <WhatItMeans retro={retro} />}

      <div className="band">
        <div className="rp-sec">
          RACE LOG
          <span className="rp-secr">{hasResult ? 'result and notes' : 'no result yet'}</span>
        </div>
        <div className="rp-panel">
          {hasResult && !formOpen ? (
            <div className="rr-logrow">
              <span className="rr-logtime">{retro?.finishDisplay}</span>
              <span className="rr-logsub">
                {retro?.provisional
                  ? retro.provisionalLabel ?? 'Provisional'
                  : 'Logged'}
                {formExisting.retroFelt ? ` · ${formExisting.retroFelt}` : ''}
                {formExisting.retroExecution ? ` · ${formExisting.retroExecution}` : ''}
              </span>
              <button type="button" className="rr-logbtn" onClick={() => setFormOpen(true)}>
                Edit result &amp; notes
              </button>
            </div>
          ) : (
            <>
              {!hasResult && (
                <div className="rr-logsub" style={{ marginBottom: 4 }}>
                  Log the finish and the story above fills in.
                </div>
              )}
              {hasResult && (
                <button type="button" className="rr-logbtn" onClick={() => setFormOpen(false)} style={{ marginBottom: 2 }}>
                  Collapse
                </button>
              )}
              <RaceRetrospectiveForm slug={slug} existing={formExisting} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ============================================================
   StoryChart · the race, mile by mile.
   x = course miles · y = pace (faster up). Phase bands named from
   races.plan; target plan dashed amber; actual stepped race-red with
   per-mile status dots; HR thin neutral trace; elevation shaded floor.
   ============================================================ */
function StoryChart({ retro }: { retro: RaceRetro }) {
  const W = 640, H = 252;
  const padL = 46, padR = 12, padT = 26, padB = 24;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const miles = retro.miles;
  const paced = miles.filter((m): m is RetroMile & { paceSPerMi: number } => m.paceSPerMi != null);
  const lastMile = miles.length > 0 ? miles[miles.length - 1].mile : 0;
  const courseEnd = Math.max(
    retro.distanceMi,
    retro.phases.length > 0 ? retro.phases[retro.phases.length - 1].endMi : 0,
    lastMile,
  );
  const x = (mi: number) => padL + (Math.min(mi, courseEnd) / courseEnd) * plotW;

  // Pace domain over actuals + targets, padded; faster (smaller) at top.
  const paceVals = [
    ...paced.map((m) => m.paceSPerMi),
    ...retro.phases.map((p) => p.targetSPerMi).filter((v): v is number => v != null),
  ];
  if (paceVals.length === 0) return null;
  let lo = Math.min(...paceVals) - 14;
  let hi = Math.max(...paceVals) + 14;
  if (hi - lo < 50) { const mid = (hi + lo) / 2; lo = mid - 25; hi = mid + 25; }
  const y = (p: number) => padT + ((p - lo) / (hi - lo)) * plotH;

  // Actual pace · stepped path. Mile i covers [i-1, i]; the final split
  // stretches to the finish line. Unreliable/missing splits break the path.
  const spanFor = (m: RetroMile): [number, number] => [
    m.mile - 1,
    m.mile === lastMile ? Math.max(m.mile, courseEnd) : m.mile,
  ];
  let actualD = '';
  let prevEnd: number | null = null;
  for (const m of miles) {
    if (m.paceSPerMi == null) { prevEnd = null; continue; }
    const [s, e] = spanFor(m);
    const yy = y(m.paceSPerMi);
    if (prevEnd != null && Math.abs(prevEnd - s) < 0.01) {
      actualD += ` V${yy.toFixed(1)} H${x(e).toFixed(1)}`;
    } else {
      actualD += ` M${x(s).toFixed(1)},${yy.toFixed(1)} H${x(e).toFixed(1)}`;
    }
    prevEnd = e;
  }

  // Target plan · dashed step across phases.
  let targetD = '';
  for (const p of retro.phases) {
    if (p.targetSPerMi == null) continue;
    const yy = y(p.targetSPerMi);
    targetD += ` M${x(p.startMi).toFixed(1)},${yy.toFixed(1)} H${x(p.endMi).toFixed(1)}`;
  }

  // Per-mile status dots vs the phase target the mile midpoint sits in.
  const dots = paced.map((m) => {
    const [s, e] = spanFor(m);
    const mid = (s + e) / 2;
    const phase = retro.phases.find((p) => mid >= p.startMi && mid < p.endMi)
      ?? retro.phases[retro.phases.length - 1];
    if (!phase || phase.targetSPerMi == null) return null;
    const delta = m.paceSPerMi - phase.targetSPerMi;
    const status = Math.abs(delta) <= retro.toleranceSPerMi ? 'on' : delta < 0 ? 'fast' : 'slow';
    return { cx: x(mid), cy: y(m.paceSPerMi), color: STATUS_COLOR[status] };
  }).filter((d): d is { cx: number; cy: number; color: string } => d != null);

  // HR trace · thin neutral line, own scale (higher HR up).
  const hrPts = miles
    .filter((m): m is RetroMile & { avgHr: number } => m.avgHr != null)
    .map((m) => { const [s, e] = spanFor(m); return { mid: (s + e) / 2, hr: m.avgHr }; });
  let hrPoly: string | null = null;
  if (hrPts.length >= 2) {
    const hLo = Math.min(...hrPts.map((p) => p.hr)) - 4;
    const hHi = Math.max(...hrPts.map((p) => p.hr)) + 4;
    const yh = (v: number) => padT + ((hHi - v) / Math.max(1, hHi - hLo)) * plotH;
    hrPoly = hrPts.map((p) => `${x(p.mid).toFixed(1)},${yh(p.hr).toFixed(1)}`).join(' ');
  }

  // Elevation floor · cumulative profile from per-mile deltas, bottom 26%.
  const elevMiles = miles.filter((m) => m.elevDeltaFt != null);
  let elevD: string | null = null;
  if (elevMiles.length >= Math.max(2, miles.length * 0.6)) {
    let cum = 0;
    const pts: Array<{ mi: number; ele: number }> = [{ mi: 0, ele: 0 }];
    for (const m of miles) {
      cum += m.elevDeltaFt ?? 0;
      pts.push({ mi: spanFor(m)[1], ele: cum });
    }
    const eLo = Math.min(...pts.map((p) => p.ele));
    const eHi = Math.max(...pts.map((p) => p.ele));
    const bandTop = padT + plotH * 0.74;
    const bandH = plotH * 0.26;
    const ye = (v: number) => bandTop + (1 - (v - eLo) / Math.max(1, eHi - eLo)) * bandH;
    elevD = `M${x(0).toFixed(1)},${(padT + plotH).toFixed(1)} `
      + pts.map((p) => `L${x(p.mi).toFixed(1)},${ye(p.ele).toFixed(1)}`).join(' ')
      + ` L${x(courseEnd).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;
  }

  // Axes.
  const paceTicks = [lo + 10, (lo + hi) / 2, hi - 10];
  const mileStep = courseEnd > 20 ? 4 : 2;
  const mileTicks: number[] = [];
  for (let mi = mileStep; mi < courseEnd - 0.8; mi += mileStep) mileTicks.push(mi);

  const estW = (s: string) => s.length * 6.2 + 10;

  return (
    <div className="rr-chartwrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="rr-chart" role="img" aria-label="Mile-by-mile pace against the course plan">
        {/* phase bands */}
        {retro.phases.map((p, i) => {
          const bx = x(p.startMi), bw = x(p.endMi) - x(p.startMi);
          const label = p.label.toUpperCase();
          return (
            <g key={i}>
              {i % 2 === 1 && (
                <rect x={bx} y={padT} width={bw} height={plotH} fill="rgba(255,255,255,.04)" />
              )}
              {i > 0 && (
                <line x1={bx} y1={padT} x2={bx} y2={padT + plotH} stroke="rgba(255,255,255,.10)" strokeWidth="1" />
              )}
              {bw >= estW(label) && (
                <text x={bx + 6} y={padT - 8} fontSize="9" fontWeight="700" letterSpacing="1.1" fill="rgba(255,255,255,.5)" fontFamily="Inter,sans-serif">
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* elevation floor */}
        {elevD && <path d={elevD} fill="rgba(255,255,255,.05)" />}

        {/* pace gridlines + labels */}
        {paceTicks.map((p, i) => (
          <g key={i}>
            <line x1={padL} y1={y(p)} x2={W - padR} y2={y(p)} stroke="rgba(255,255,255,.05)" strokeWidth="1" />
            <text x={padL - 7} y={y(p) + 3} fontSize="9" fontWeight="600" fill="rgba(255,255,255,.45)" textAnchor="end" fontFamily="Inter,sans-serif">
              {fmtPaceShort(p)}
            </text>
          </g>
        ))}

        {/* mile axis */}
        {mileTicks.map((mi) => (
          <text key={mi} x={x(mi)} y={H - 8} fontSize="8.5" fontWeight="700" letterSpacing=".5" fill="rgba(255,255,255,.4)" textAnchor="middle" fontFamily="Inter,sans-serif">
            MI {mi}
          </text>
        ))}
        <text x={x(courseEnd)} y={H - 8} fontSize="8.5" fontWeight="700" letterSpacing=".5" fill="rgba(255,255,255,.55)" textAnchor="end" fontFamily="Inter,sans-serif">
          FINISH
        </text>

        {/* HR trace */}
        {hrPoly && (
          <polyline points={hrPoly} fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* target plan */}
        {targetD && (
          <path d={targetD} fill="none" stroke="#F3AD38" strokeWidth="1.75" strokeDasharray="5 4" strokeLinecap="round" />
        )}

        {/* actual pace */}
        {actualD && (
          <path d={actualD} fill="none" stroke="#D03F3F" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        )}

        {/* per-mile status dots */}
        {dots.map((d, i) => (
          <circle key={i} cx={d.cx} cy={d.cy} r="3" fill={d.color} stroke="#0A0C10" strokeWidth="1.25" />
        ))}
      </svg>

      <div className="rr-legend">
        <span><i className="sw" style={{ background: '#D03F3F' }} />Ran</span>
        {retro.phases.some((p) => p.targetSPerMi != null) && (
          <span><i className="sw dash" style={{ borderColor: '#F3AD38' }} />Plan</span>
        )}
        {hrPoly && <span><i className="sw" style={{ background: 'rgba(255,255,255,.4)' }} />HR</span>}
        <span><i className="dot" style={{ background: STATUS_COLOR.on }} />On</span>
        <span><i className="dot" style={{ background: STATUS_COLOR.fast }} />Fast</span>
        <span><i className="dot" style={{ background: STATUS_COLOR.slow }} />Slow</span>
        {retro.milesSource === 'watch' && <span className="src">Watch data</span>}
      </div>
    </div>
  );
}

/* ============================================================
   PhaseTable · phase name · target · actual · delta.
   ============================================================ */
function PhaseTable({ retro }: { retro: RaceRetro }) {
  const showDeltas = retro.phases.some((p) => p.deltaSPerMi != null);
  return (
    <div className="rr-table">
      <div className="rr-tr rr-th">
        <span>PHASE</span>
        <span>TARGET</span>
        <span>RAN</span>
        <span>&Delta;/MI</span>
      </div>
      {retro.phases.map((p, i) => (
        <div className="rr-tr" key={i}>
          <span className="rr-cph">
            {p.status && <i className="rr-cst" style={{ background: STATUS_COLOR[p.status] }} />}
            <span className="rr-cnm">{p.label}</span>
            <span className="rr-crg">{trimMi(p.startMi)}&ndash;{trimMi(p.endMi)} mi</span>
          </span>
          <span className="rr-ctv">{p.targetDisplay ?? '·'}</span>
          <span className="rr-cav">{p.actualDisplay ?? '·'}</span>
          <span className="rr-cdv" style={{ color: p.status ? STATUS_COLOR[p.status] : undefined }}>
            {p.deltaDisplay ?? '·'}
          </span>
        </div>
      ))}
      {retro.finishS != null && (
        <div className="rr-tr rr-tf">
          <span className="rr-cph"><span className="rr-cnm">Finish</span></span>
          <span className="rr-ctv">{retro.goalSec != null ? fmtClock(retro.goalSec) : '·'}</span>
          <span className="rr-cav">{fmtClock(retro.finishS)}</span>
          <span className="rr-cdv" style={{ color: gapColor(retro.gapS) }}>
            {retro.gapS != null ? `${retro.gapS < 0 ? '-' : '+'}${fmtGap(retro.gapS)}` : '·'}
          </span>
        </div>
      )}
      {showDeltas && (
        <div className="rr-tolnote">Green within {retro.toleranceSPerMi}s/mi of the phase target.</div>
      )}
    </div>
  );
}

function trimMi(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function gapColor(gapS: number | null): string | undefined {
  if (gapS == null) return undefined;
  if (gapS <= 0) return STATUS_COLOR.on;
  return STATUS_COLOR.slow;
}

/* ============================================================
   WhatItMeans · VDOT + projection movement + the next race read.
   ============================================================ */
function WhatItMeans({ retro }: { retro: RaceRetro }) {
  const sentences: string[] = [];

  if (retro.provisional) {
    sentences.push('Watch time, provisional. Confirm the chip time and these numbers lock.');
  }
  if (retro.goalSec != null && retro.finishS != null) {
    const gap = retro.finishS - retro.goalSec;
    if (Math.abs(gap) <= 30) {
      sentences.push(`Goal ${fmtClock(retro.goalSec)} · ran ${fmtClock(retro.finishS)}. On the number.`);
    } else if (gap < 0) {
      sentences.push(`Goal ${fmtClock(retro.goalSec)} · ran ${fmtClock(retro.finishS)}. ${fmtGap(gap)} under.`);
    } else {
      const disp = fmtGap(gap);
      sentences.push(`Goal ${fmtClock(retro.goalSec)} · ran ${fmtClock(retro.finishS)}. ${gapArticle(disp)} ${disp} gap.`);
    }
  }
  if (retro.projBeforeSec != null && retro.finishS != null) {
    const d = retro.finishS - retro.projBeforeSec;
    if (Math.abs(d) <= 60) {
      sentences.push(`The model called ${fmtClock(retro.projBeforeSec)}. It held.`);
    } else if (d < 0) {
      sentences.push(`The model called ${fmtClock(retro.projBeforeSec)}. You beat it by ${fmtGap(d)}. Fitness is ahead of the book.`);
    } else {
      sentences.push(`The model called ${fmtClock(retro.projBeforeSec)}. ${fmtGap(d)} over it. The race is the truer read; paces adjust from here.`);
    }
  }
  if (retro.nextRace) {
    const n = retro.nextRace;
    if (n.goalSec != null && n.predictedSec != null) {
      const gapNext = n.predictedSec - n.goalSec;
      if (gapNext <= 0) {
        sentences.push(`${n.name} asks ${fmtClock(n.goalSec)}. Today's fitness covers it. Hold the block.`);
      } else if (gapNext <= 60) {
        sentences.push(`${n.name} asks ${fmtClock(n.goalSec)}. You are on the number with ${n.weeksAway} weeks to hold it.`);
      } else {
        sentences.push(`${n.name} asks ${fmtClock(n.goalSec)}. Today's fitness runs ${fmtClock(n.predictedSec)}. ${n.weeksAway} weeks to close ${fmtGap(gapNext)}.`);
      }
    } else if (n.predictedSec != null) {
      sentences.push(`${n.name} in ${n.weeksAway} weeks. Today's fitness runs ${fmtClock(n.predictedSec)} there. Set the goal and the plan prices it.`);
    }
  }
  if (sentences.length === 0) return null;

  return (
    <div className="band">
      <div className="rp-sec">
        WHAT IT MEANS
        {retro.provisional && <span className="rp-secr" style={{ color: '#F3AD38', opacity: 1 }}>watch time · provisional</span>}
      </div>
      <div className="rr-tiles">
        {retro.vdotRace != null && (
          <div className="rr-tile">
            <div className="k">VDOT · THIS RACE</div>
            <div className="v">{retro.vdotRace.toFixed(1)}</div>
            <div className="s">
              {retro.vdotBefore != null ? `${retro.vdotBefore.toFixed(1)} before` : 'first anchor'}
            </div>
          </div>
        )}
        {(retro.projBeforeSec != null || retro.projAfterSec != null) && (
          <div className="rr-tile">
            <div className="k">{distName(retro.distanceMi).toUpperCase()} PROJECTION</div>
            <div className="v">{fmtClock(retro.projAfterSec)}</div>
            <div className="s">
              {retro.projBeforeSec != null ? `${fmtClock(retro.projBeforeSec)} before the race` : 'from this result'}
            </div>
          </div>
        )}
        {retro.nextRace?.predictedSec != null && (
          <div className="rr-tile">
            <div className="k">NEXT · {retro.nextRace.name.toUpperCase()}</div>
            <div className="v">{fmtClock(retro.nextRace.predictedSec)}</div>
            <div className="s">
              {retro.nextRace.goalDisplay ? `goal ${retro.nextRace.goalDisplay} · ` : ''}{retro.nextRace.weeksAway} weeks away
            </div>
          </div>
        )}
      </div>
      <div className="rp-panel rp-insight">
        <span className="ct">COACH</span>
        <span className="cx">{sentences.join(' ')}</span>
      </div>
    </div>
  );
}

function distName(mi: number): string {
  if (mi >= 25 && mi <= 27) return 'Marathon';
  if (mi >= 12 && mi <= 14) return 'Half';
  if (mi >= 6 && mi <= 7) return '10K';
  if (mi >= 3 && mi <= 3.5) return '5K';
  return `${mi.toFixed(1)} mi`;
}
