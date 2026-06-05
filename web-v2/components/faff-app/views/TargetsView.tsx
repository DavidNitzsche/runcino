'use client';

/**
 * TargetsView · rebuild (2026-06-04)
 *
 * Implements `designs/from Design agent/targets-rebuild/`.  The page is a
 * top-to-bottom narrative · the answer → the path → the work → the
 * record → the calendar.  Mesh is neutral charcoal (see constants.ts ·
 * MESH.targets) and semantic color is reserved for the data only.
 *
 * Sections:
 *   1 · ANSWER   · goal hero (left) + projection band (right)
 *   2 · PATH     · status headline + signals + recent/next test points
 *                 + 3-rung status ladder
 *   3 · WORK     · current VDOT + 6w delta + held/implies/goalVDOT meta
 *   4 · PRs      · anchor line vs goal + 4-card grid (PR @ goal distance
 *                 highlighted)
 *   5 · RACES    · upcoming calendar + "New goal" action
 *
 * The off-track state still renders the existing `GapPanel` between
 * sections 1 and 3 because the redesign brief only covers ON TRACK /
 * WATCHING.  When the off-track redesign lands, replace the GapPanel
 * fallback below.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed, GoalRace } from '../types';
import { LogNonRunSheet, NewGoalSheet } from '../toolkit';
import { GapPanel } from './GapPanel';
import { parseRaceTime, vdotFromRace, formatRaceTime } from '@/lib/training/vdot';

export function TargetsView({
  seed, onOpenRace,
}: { seed: FaffSeed; onOpenRace: (slug: string) => void; onOpenReach?: () => void }) {
  const router = useRouter();
  const goal = seed.goalRace;
  const [goalOpen, setGoalOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  // === GUEST / NO-GOAL ====================================================
  if (!goal) {
    return (
      <div className="targets2">
        <div className="top">
          <div>
            <div className="date">Targets</div>
            <div className="wk">Goals &amp; races</div>
          </div>
        </div>
        <div className="t2card" style={{ padding: '36px 40px' }}>
          <div className="eyebrow">No primary goal</div>
          <div style={{ marginTop: 14, fontSize: 18, lineHeight: 1.5, color: 'rgba(255,255,255,.86)' }}>
            Set a primary race to start tracking your gap to goal.
          </div>
          <div className="raceacts" style={{ marginTop: 22 }}>
            <button type="button" className="racebtn" onClick={() => setGoalOpen(true)}>+ New goal</button>
          </div>
        </div>
        {goalOpen ? (
          <SheetOverlay onDismiss={() => setGoalOpen(false)}>
            <NewGoalSheet onSaved={() => router.refresh()} onClose={() => setGoalOpen(false)} />
          </SheetOverlay>
        ) : null}
      </div>
    );
  }

  // === DERIVED VALUES =====================================================
  const status = goal.goalStatus ?? 'on-track';
  const goalSec = parseRaceTime(goal.goal) ?? null;
  const fitSec = goal.vdotProjectionSec ?? null;
  const gapSec = goalSec != null && fitSec != null ? fitSec - goalSec : null; // positive = slower than goal

  // VDOT block · derived from projectionTrend (latest, 6-weeks-ago).
  const trend = seed.projectionTrend ?? [];
  const latestVdot = lastNonNull(trend.map(t => t.vdot));
  const sixWeeksAgoVdot = vdotAtDaysAgo(trend, 42);
  const vdotDelta = latestVdot != null && sixWeeksAgoVdot != null
    ? Number((latestVdot - sixWeeksAgoVdot).toFixed(1))
    : null;
  const vdotHeldDays = trend.length > 0 ? daysHeld(trend, latestVdot) : null;
  const goalVdot = goalSec != null && goal.distanceMi != null
    ? vdotFromRace(goalSec, goal.distanceMi)
    : null;

  // PR anchor (which PR is closest to the goal distance) — used to
  // highlight the PR card and write the anchor line.
  const goalDist = goal.distanceMi ?? null;
  const anchorPr = goalDist != null
    ? seed.prs.find(p => prDistanceMi(p.k) === goalDist) ?? null
    : null;
  const anchorPrSec = anchorPr ? parseRaceTime(anchorPr.v) : null;
  const anchorGapSec = anchorPrSec != null && goalSec != null
    ? anchorPrSec - goalSec
    : null;

  return (
    <div className="targets2">
      <div className="top">
        <div>
          <div className="date">Targets</div>
          <div className="wk">Goals &amp; races</div>
        </div>
      </div>

      {/* ============ SECTION 1 · THE ANSWER ============ */}
      <div className="answer">
        <div className="goalblock">
          <div className="eyebrow">Primary goal</div>
          <div className="goaltime">{goal.goal}</div>
          <div className="goalmeta">
            <b>{goal.name}</b>
            {goal.location ? <> · {goal.location}</> : null}
            {' · '}{formatDate(goal.date)}
          </div>
          <div className="statusrow">
            <StatusPill status={status} />
            <span className="stx">{posturePhrase(goal, status)}</span>
            <span className="dot">·</span>
            <span className="days"><b>{goal.daysAway}</b> days out</span>
          </div>
        </div>

        <div className="t2card bandcard">
          <div className="bandhead">
            <div className="t">Projection</div>
            <div className="t" style={{ color: 'rgba(255,255,255,.72)' }}>
              {goal.daysAway} days out · {statusWord(status)}
            </div>
          </div>
          <ProjectionBand
            goalSec={goalSec}
            fitSec={fitSec}
            status={status}
            gapText={gapText(gapSec, status)}
          />
          <div className="bandcap">{bandCaption(goal, gapSec, status)}</div>
        </div>
      </div>

      {/* off-track keeps the legacy GapPanel until the off-track redesign
          lands · the new ON THE PATH narrative is for on-track + watching. */}
      {status === 'off-track' ? (
        <>
          <div className="eyebrow-sec">Closing the gap</div>
          <GapPanel goal={goal} series={seed.projectionTrend} />
        </>
      ) : (
        <>
          {/* ============ SECTION 2 · THE PATH ============ */}
          <div className="eyebrow-sec">On the path</div>
          <div className="t2card pathcard">
            <div className="pathhead">
              <h3>{pathHeadline(status)}</h3>
              <p>{pathSubline(goal, status)}</p>
            </div>
            {goal.driftSignals && goal.driftSignals.length > 0 ? (
              goal.driftSignals.map((s, i) => (
                <div key={i} className={`signal ${s.weight}`}>
                  <span className="sig-w">{s.weight}</span>
                  <div className="sig-tx">
                    {s.detail}
                    {evidenceLine(s) ? <span className="ev">{evidenceLine(s)}</span> : null}
                  </div>
                </div>
              ))
            ) : null}

            <div className="hr" />

            <TestPointsGrid
              recent={goal.recentTestPoints ?? []}
              next={goal.nextTestPoints ?? []}
            />

            <div className="hr" />

            <StatusLadder goal={goal} status={status} />
          </div>

          {/* ============ SECTION 3 · THE WORK · VDOT ============ */}
          {latestVdot != null ? (
            <>
              <div className="eyebrow-sec">The work behind the number</div>
              <div className="t2card vdotcard">
                <div className="vdotmain">
                  <div className="lbl">Current fitness · VDOT</div>
                  <div className="vdotrow">
                    <span className="big">{latestVdot.toFixed(1)}</span>
                    {vdotDelta != null ? <VdotDelta delta={vdotDelta} /> : null}
                  </div>
                </div>
                <div className="vdotaside">
                  <div className="vdotsub">{vdotReadCopy(latestVdot, vdotDelta, vdotHeldDays)}</div>
                  <div className="vdotmeta">
                    {vdotHeldDays != null ? (
                      <div className="m"><div className="mk">Held</div><div className="mv">{vdotHeldDays} days</div></div>
                    ) : null}
                    {fitSec != null ? (
                      <div className="m">
                        <div className="mk">Implies</div>
                        <div className="mv">{formatRaceTime(fitSec) ?? '·'}</div>
                      </div>
                    ) : null}
                    {goalVdot != null ? (
                      <div className="m">
                        <div className="mk">Goal VDOT</div>
                        <div className="mv">~{goalVdot.toFixed(1)}</div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </>
      )}

      {/* ============ SECTION 4 · PRs ANCHORED ============ */}
      <div className="eyebrow-sec">Personal records · measured against the goal</div>
      {anchorPr && anchorGapSec != null ? (
        <div className={`anchorline ${status === 'on-track' ? 'ontrack' : ''}`}>
          Your {anchorPr.k.toLowerCase()} PR is <b>{anchorPr.v}</b>.
          {' '}The goal is <b>{goal.goal}</b>
          {anchorGapSec > 0 ? (
            <> · a <span className="gp">{formatGap(anchorGapSec)} gap</span>, about <b>{formatPerMile(anchorGapSec, goalDist!)}/mi</b>. That's the distance the build is built to close.</>
          ) : (
            <> · you're already under it by <b>{formatGap(-anchorGapSec)}</b>. The build is about holding that and going further.</>
          )}
        </div>
      ) : null}
      <div className="prgrid2">
        {seed.prs.map(p => {
          const isAnchor = anchorPr && p.k === anchorPr.k;
          return (
            <div className={`prt2 ${isAnchor ? 'hl' : ''}`} key={p.k}>
              {isAnchor && anchorGapSec != null && anchorGapSec > 0 ? (
                <span className="gapchip">−{formatGap(anchorGapSec)} to goal</span>
              ) : null}
              <div className="prd">{p.k}</div>
              <div className="prv">{p.v}</div>
              <div className="prm">{p.date}</div>
            </div>
          );
        })}
      </div>

      {/* ============ SECTION 5 · RACES ============ */}
      <div className="eyebrow-sec">Races</div>
      <div className="racelist">
        {seed.races.map((r, i) => (
          <div
            className="racerow"
            key={r.slug + i}
            onClick={() => onOpenRace(r.slug)}
            role="button"
            tabIndex={0}
          >
            <div className="rinfo">
              <div className="rn">{r.name}</div>
              <div className="rdate">{r.meta}</div>
            </div>
            <span className={`racetag ${r.tag === 'A RACE' ? 'a' : 'tune'}`}>
              {r.tag === 'A RACE' ? 'A race' : 'Tune-up'}
            </span>
            <span className="racedays">
              {String(r.days).replace(/[^0-9]/g, '') || r.days}
              <small>days</small>
            </span>
          </div>
        ))}
      </div>
      <div className="raceacts">
        <button type="button" className="racebtn" onClick={() => setGoalOpen(true)}>+ New goal</button>
        <button type="button" className="racebtn" onClick={() => setLogOpen(true)}>+ Log strength / cross</button>
      </div>

      {goalOpen ? (
        <SheetOverlay onDismiss={() => setGoalOpen(false)}>
          <NewGoalSheet onSaved={() => router.refresh()} onClose={() => setGoalOpen(false)} />
        </SheetOverlay>
      ) : null}
      {logOpen ? (
        <SheetOverlay onDismiss={() => setLogOpen(false)}>
          <LogNonRunSheet onSaved={() => router.refresh()} onClose={() => setLogOpen(false)} />
        </SheetOverlay>
      ) : null}
    </div>
  );
}

// ============================ STATUS PILL ============================
function StatusPill({ status }: { status: 'on-track' | 'watching' | 'off-track' }) {
  if (status === 'on-track') {
    return <span className="spill ontrack"><span className="d" />On track</span>;
  }
  if (status === 'off-track') {
    return <span className="spill off"><span className="d" />Off track</span>;
  }
  return <span className="spill watch"><span className="d" />Watching</span>;
}

// ============================ PROJECTION BAND ============================
/**
 * Horizontal number line · slower → faster left-to-right, goal sits on
 * the right.  Positions are computed from the actual time delta on a
 * fixed scale (±10% of goal time around goal), clamped so both markers
 * stay inside the band.
 */
function ProjectionBand({
  goalSec, fitSec, status, gapText,
}: {
  goalSec: number | null;
  fitSec: number | null;
  status: 'on-track' | 'watching' | 'off-track';
  gapText: string;
}) {
  if (goalSec == null) {
    return <div className="band"><div className="btrack" /></div>;
  }
  // Scale · left = 1.10 × goal (slowest), right = 0.97 × goal (fastest)
  // gives the goal marker around 77% (matches design intent of
  // "goal sits on the right" without being pinned to the edge).
  const left = goalSec * 1.10;
  const right = goalSec * 0.97;
  const pos = (x: number) => {
    const raw = (left - x) / (left - right);
    return Math.min(0.95, Math.max(0.05, raw)) * 100;
  };
  const goalPct = pos(goalSec);
  const fitPct = fitSec != null ? pos(fitSec) : null;
  const gapClass =
    status === 'on-track' ? 'ontrack'
    : status === 'off-track' ? 'off'
    : '';
  return (
    <div className="band">
      <div className="btrack" />
      {fitPct != null && fitPct < goalPct ? (
        <>
          <div className="bgap" style={{ left: `${fitPct}%`, width: `${goalPct - fitPct}%` }} />
          <div className={`bgaplab ${gapClass}`} style={{ left: `${(fitPct + goalPct) / 2}%` }}>
            {gapText}
          </div>
        </>
      ) : null}
      {fitPct != null ? (
        <div className="bpt fit" style={{ left: `${fitPct}%` }}>
          <div className="dot" />
          <div className="cap">
            <span className="v">{formatRaceTime(fitSec!) ?? '·'}</span>
            <span className="k">Current fitness</span>
          </div>
        </div>
      ) : null}
      <div className="bpt goal" style={{ left: `${goalPct}%` }}>
        <div className="cap">
          <span className="v">{formatRaceTime(goalSec) ?? '·'}</span>
          <span className="k">Plan target</span>
        </div>
        <div className="dot" />
      </div>
    </div>
  );
}

// ============================ TEST POINTS GRID ============================
function TestPointsGrid({
  recent, next,
}: {
  recent: NonNullable<GoalRace['recentTestPoints']>;
  next: NonNullable<GoalRace['nextTestPoints']>;
}) {
  const showBoth = recent.length > 0 && next.length > 0;
  const showOnly = recent.length > 0 || next.length > 0;
  if (!showOnly) return null;
  return (
    <div className={`testgrid ${showBoth ? '' : 'one'}`}>
      {recent.length > 0 ? (
        <div className="tcol">
          <h4>Recent test points</h4>
          {recent.map((tp, i) => (
            <div className="trow" key={'r' + i}>
              <span className="td">{formatTestDate(tp.dateISO)}</span>
              <span className="tl">{splitLabel(tp.label)}</span>
              <span className="tpace">{tp.actualPace ?? '·'}</span>
              <span className={`verdict ${tp.verdict ?? 'on'}`}>
                {tp.verdict === 'slow' ? (
                  <>Slow</>
                ) : tp.verdict === 'fast' ? (
                  <>Fast</>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    On
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {next.length > 0 ? (
        <div className="tcol">
          <h4>Next test points</h4>
          {next.map((tp, i) => (
            <div className="trow next" key={'n' + i}>
              <span className="td">{formatTestDate(tp.dateISO)}</span>
              <span className="tl">{splitLabel(tp.label)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ============================ STATUS LADDER ============================
function StatusLadder({
  goal, status,
}: {
  goal: GoalRace;
  status: 'on-track' | 'watching' | 'off-track';
}) {
  const tr = goal.transitions ?? { toBetter: null, toWorse: null };
  return (
    <div className="ladder">
      <h4>What moves the status</h4>
      <div className={`rung up ${status === 'on-track' ? 'here ontrack' : ''}`}>
        <span className="rl">
          <span className="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </span>
          On track
          {status === 'on-track' ? <span className="here-tag">You are here</span> : null}
        </span>
        <span className="rx">
          {status === 'on-track'
            ? 'Plan is on pace · the work is doing the work.'
            : (tr.toBetter ?? 'A new race within 5% of goal pace clears this · or 3+ weeks of tempo paces hitting plan targets re-rates VDOT from training.')}
        </span>
      </div>
      <div className={`rung ${status === 'watching' ? 'here' : ''}`}>
        <span className="rl">
          <span className="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
          </span>
          Watching
          {status === 'watching' ? <span className="here-tag">You are here</span> : null}
        </span>
        <span className="rx">
          {status === 'watching'
            ? `One soft signal is live. The plan holds ${goal.goal} · execution is on target.`
            : 'Soft drift signals fire here · plan stays the same, we just watch the next quality run.'}
        </span>
      </div>
      <div className={`rung down ${status === 'off-track' ? 'here off' : ''}`}>
        <span className="rl">
          <span className="ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
          </span>
          Off track
          {status === 'off-track' ? <span className="here-tag">You are here</span> : null}
        </span>
        <span className="rx">
          {tr.toWorse ?? 'Fires if another medium signal stacks · or a recent race lands 10%+ off goal · or VDOT trend drops 1+ point over 4 weeks. Headline switches to the raw projection.'}
        </span>
      </div>
    </div>
  );
}

// ============================ VDOT DELTA ============================
function VdotDelta({ delta }: { delta: number }) {
  const cls = delta > 0 ? '' : delta < 0 ? 'down' : 'flat';
  if (delta === 0) {
    return <span className={`delta ${cls}`}>flat</span>;
  }
  return (
    <span className={`delta ${cls}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 15, height: 15 }}>
        {delta > 0 ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
      </svg>
      {Math.abs(delta).toFixed(1)}
    </span>
  );
}

// ============================ SHEETS ============================
function SheetOverlay({ children, onDismiss }: { children: React.ReactNode; onDismiss: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        background: 'rgba(0,0,0,.55)',
      }}
      onClick={onDismiss}
    >
      <div style={{ width: '100%', maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ============================ HELPERS ============================

function formatDate(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

function formatTestDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(d);
}

function formatGap(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatPerMile(gapSec: number, distMi: number): string {
  const perMi = Math.round(gapSec / distMi);
  return `${perMi}s`;
}

/** Split "8mi tempo · 5 mi @ T" into ["8mi tempo", "5 mi @ T"] · the
 *  detail half renders as a smaller, dimmer aside. */
function splitLabel(label: string): React.ReactNode {
  const i = label.indexOf(' · ');
  if (i === -1) return label;
  return <>{label.slice(0, i)}<small> · {label.slice(i + 3)}</small></>;
}

function posturePhrase(_goal: GoalRace, status: 'on-track' | 'watching' | 'off-track'): string {
  if (status === 'on-track') return 'Plan is on pace';
  if (status === 'off-track') return 'Honest read';
  return 'Holding the plan';
}

function statusWord(status: 'on-track' | 'watching' | 'off-track'): string {
  if (status === 'on-track') return 'on pace';
  if (status === 'off-track') return 'off pace';
  return 'holding';
}

function gapText(gapSec: number | null, status: 'on-track' | 'watching' | 'off-track'): string {
  if (gapSec == null || gapSec <= 0) {
    return status === 'on-track' ? 'on pace' : 'watching';
  }
  return `${formatGap(gapSec)} gap · ${status === 'off-track' ? 'off pace' : 'watching'}`;
}

function bandCaption(goal: GoalRace, gapSec: number | null, status: 'on-track' | 'watching' | 'off-track'): React.ReactNode {
  const fit = goal.vdotProjectionSec != null ? formatRaceTime(goal.vdotProjectionSec) : null;
  if (status === 'on-track') {
    return (
      <>
        The plan still targets <b>{goal.goal}</b> · execution is on pace.
        {fit ? <> Raw fitness reads <b>{fit}</b> · ahead of the target.</> : null}
      </>
    );
  }
  if (status === 'off-track' && fit && gapSec != null && gapSec > 0) {
    return (
      <>
        Raw fitness reads <b>{fit}</b> · {formatGap(gapSec)} off the {goal.goal} target.
        {' '}The plan is closing the gap.
      </>
    );
  }
  return (
    <>
      The plan still targets <b>{goal.goal}</b> · we hold the line until the evidence clearly says we can't.
      {fit ? <> Raw fitness reads <b>{fit}</b> today · that gap is what we're watching.</> : null}
    </>
  );
}

function pathHeadline(status: 'on-track' | 'watching' | 'off-track'): string {
  if (status === 'on-track') return 'On track · the plan is the path.';
  if (status === 'off-track') return 'Off track · closing the gap.';
  return 'Watching · soft signals firing.';
}

function pathSubline(goal: GoalRace, status: 'on-track' | 'watching' | 'off-track'): string {
  if (goal.projectionSummary) return goal.projectionSummary;
  if (status === 'on-track') return 'The work is doing the work · stay the course.';
  if (status === 'off-track') return 'The next blocks are written to close it.';
  return 'Hold the plan · the next quality run will tell us more.';
}

function evidenceLine(s: { kind: string; evidence: Record<string, number | string | null> }): string | null {
  if (s.kind === 'recent_race') {
    return 'Most recent comparable race · within the 90-day window the projection reads from.';
  }
  if (s.kind === 'vdot_trend') return 'VDOT trend across the last 4 weeks.';
  if (s.kind === 'aerobic_decoupling') return 'Aerobic decoupling above the doctrine threshold.';
  if (s.kind === 'tempo_pace_drift') return 'Tempo paces drifting from plan targets.';
  if (s.kind === 'plan_adapter_downgrades') return 'Plan adapter has downgraded recent quality.';
  if (s.kind === 'missed_key_workouts') return 'Missed or skipped key workouts in the last block.';
  return null;
}

function vdotReadCopy(vdot: number, delta: number | null, heldDays: number | null): React.ReactNode {
  if (delta != null && delta > 0) {
    return (
      <>
        Up <b>{delta.toFixed(1)} points</b> across the block.
        {' '}The model only moves on a real result or a breakthrough session, so a flat read is expected, not a stall.
      </>
    );
  }
  if (delta != null && delta < 0) {
    return (
      <>
        Down <b>{Math.abs(delta).toFixed(1)} points</b> across the block.
        {' '}One soft signal · we watch the next quality run before adjusting the plan.
      </>
    );
  }
  if (heldDays != null) {
    return (
      <>
        Flat across <b>{heldDays} days</b>.
        {' '}The model only moves on a real result or a breakthrough session, so a flat read is expected, not a stall.
      </>
    );
  }
  return <>VDOT <b>{vdot.toFixed(1)}</b> · the model only moves on a real result or a breakthrough session.</>;
}

function lastNonNull(arr: Array<number | null>): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] != null) return arr[i];
  }
  return null;
}

function vdotAtDaysAgo(
  trend: Array<{ date: string; vdot: number | null }>,
  daysAgo: number,
): number | null {
  if (trend.length === 0) return null;
  // Find the trend entry closest to N days before the latest date.
  const latestIso = trend[trend.length - 1].date;
  const latestT = Date.parse(latestIso + 'T00:00:00Z');
  if (isNaN(latestT)) return null;
  const targetT = latestT - daysAgo * 86400_000;
  let best: number | null = null;
  let bestDelta = Infinity;
  for (const row of trend) {
    if (row.vdot == null) continue;
    const t = Date.parse(row.date + 'T00:00:00Z');
    if (isNaN(t)) continue;
    const delta = Math.abs(t - targetT);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = row.vdot;
    }
  }
  return best;
}

function daysHeld(
  trend: Array<{ date: string; vdot: number | null }>,
  currentVdot: number | null,
): number | null {
  if (currentVdot == null || trend.length === 0) return null;
  // Walk backwards from the latest entry · count consecutive days where
  // vdot equals (within .05) the current value.
  let last: number | null = null;
  for (let i = trend.length - 1; i >= 0; i--) {
    const row = trend[i];
    if (row.vdot == null) continue;
    if (Math.abs(row.vdot - currentVdot) > 0.05) {
      const start = trend[i + 1]?.date ?? null;
      if (!start) return null;
      const startT = Date.parse(start + 'T00:00:00Z');
      const latestT = Date.parse(trend[trend.length - 1].date + 'T00:00:00Z');
      if (isNaN(startT) || isNaN(latestT)) return null;
      return Math.max(1, Math.round((latestT - startT) / 86400_000));
    }
    last = row.vdot;
  }
  // VDOT never changed across the full trend window.
  const latestT = Date.parse(trend[trend.length - 1].date + 'T00:00:00Z');
  const earliestT = Date.parse(trend[0].date + 'T00:00:00Z');
  if (isNaN(latestT) || isNaN(earliestT)) return null;
  return Math.max(1, Math.round((latestT - earliestT) / 86400_000));
}

/** PR label → distance in miles. Returns null for unknown labels. */
function prDistanceMi(label: string): number | null {
  const s = label.toLowerCase().trim();
  if (s === '5k') return 3.10686;
  if (s === '10k') return 6.21371;
  if (s === 'half' || s === 'half marathon') return 13.1094;
  if (s === 'marathon' || s === 'full') return 26.2188;
  return null;
}
