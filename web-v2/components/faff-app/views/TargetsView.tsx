'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { FaffSeed } from '../types';
import { LogNonRunSheet, NewGoalSheet } from '../toolkit';
import { GapPanel } from './GapPanel';

export function TargetsView({
  seed, onOpenRace,
}: { seed: FaffSeed; onOpenRace: (slug: string) => void; onOpenReach?: () => void }) {
  const router = useRouter();
  const goal = seed.goalRace;
  const [goalOpen, setGoalOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // The "Coach spotted something" banner stays hidden until the coach
  // engine actually emits a within-reach signal (no such surface yet).
  // When that ships, accept a `coachInsight` prop and render the banner
  // conditionally on its presence.
  return (
    <>
      <div className="top">
        <div>
          <div className="date">Targets</div>
          <div className="wk">Goals &amp; races</div>
        </div>
      </div>

      <div className="goalhero">
        <div className="ghleft">
          <div className="ghk">PRIMARY GOAL</div>
          <div className="ghtitle">{goal ? goal.goal : 'NO GOAL'}</div>
          <div className="ghsub">{goal ? `${goal.name}${goal.location ? ' · ' + goal.location : ''} · ${formatDate(goal.date)}` : 'Set a primary race to start tracking your gap'}</div>
          <div className="ghcd">
            <b>{goal?.daysAway ?? '·'}</b> days out · <span className={goal?.onTrack ? 'ok2' : ''}>{goal ? (goal.onTrack ? `on track · ${goal.delta}` : goal.delta) : '·'}</span>
          </div>
        </div>
        <div className="ghgauge">
          <svg viewBox="0 -14 300 176" width="220" style={{ height: 'auto' }}>
            <defs>
              <linearGradient id="gz2" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#FC4D64"/>
                <stop offset=".4" stopColor="#F3AD38"/>
                <stop offset=".6" stopColor="#3EBD41"/>
                <stop offset="1" stopColor="#3EBD41"/>
              </linearGradient>
            </defs>
            <path d="M30,150 A120,120 0 0 1 270,150" fill="none" stroke="url(#gz2)" strokeWidth="15" strokeLinecap="round"/>
            <line x1="166.9" y1="43.3" x2="170.6" y2="19.6" stroke="#fff" strokeWidth="3" />
            <text x="172.5" y="7.8" fill="#fff" fontSize="11" fontWeight="700" textAnchor="middle" fontFamily="Inter">GOAL</text>
            <line x1="140.6" y1="162.9" x2="207.6" y2="70.7" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
            <circle cx="150" cy="150" r="9" fill="#fff" />
            <circle cx="150" cy="150" r="4" fill="#10131A" />
          </svg>
          <div className="gapval center">
            <div className="grbig">{goal?.projected ?? '·'}</div>
            <div className="grstat">PROJECTED</div>
          </div>
        </div>
      </div>

      {/* 2026-06-04 · plan-trusts-itself doctrine. The "Closing the gap"
          panel only renders when the engine sees CLEAR drift evidence.
          Otherwise the runner sees the plan-is-the-path framing · "you
          are on the path, here's what's next." Status comes from
          goalStatus (see lib/training/goal-projection.ts). */}
      {goal ? (
        goal.goalStatus === 'off-track' ? (
          <>
            <div className="fll" style={{ marginTop: 30 }}>CLOSING THE GAP</div>
            <div style={{ marginTop: 12 }}>
              <GapPanel goal={goal} series={seed.projectionTrend} />
            </div>
          </>
        ) : (
          <>
            <div className="fll" style={{ marginTop: 30 }}>ON THE PATH</div>
            <div style={{ marginTop: 12 }} className="onpath-panel">
              <div className="onpath-hl">
                {goal.goalStatus === 'watching'
                  ? 'Watching · soft signals firing.'
                  : 'The plan is the path.'}
              </div>
              <div className="onpath-sub">
                {goal.projectionSummary
                  ?? (goal.goalStatus === 'watching'
                      ? 'Hold the plan · next quality run will tell us more.'
                      : `${goal.daysAway} days to ${goal.name}. The work is doing the work.`)}
              </div>
              {goal.driftSignals && goal.driftSignals.length > 0 ? (
                <div className="onpath-watching">
                  {goal.driftSignals.map((s, i) => (
                    <div key={i} className="onpath-signal">
                      <span className={`onpath-sig-w onpath-sig-${s.weight}`}>
                        {s.weight.toUpperCase()}
                      </span>
                      <span>{s.detail}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {goal.vdotProjectionSec ? (
                <div className="onpath-diag">
                  Diagnostic · current VDOT projects {formatProjSec(goal.vdotProjectionSec)} ·
                  shown for transparency, not as a prescription.
                </div>
              ) : null}
            </div>
          </>
        )
      ) : null}

      <div className="fll" style={{ marginTop: 30 }}>PERSONAL RECORDS</div>
      <div className="prgrid">
        {seed.prs.map(p => (
          <div className="prt" key={p.k}>
            <div className="prd">{p.k}</div>
            <div className="prv">{p.v}</div>
            <div className="prm">{p.date}</div>
          </div>
        ))}
      </div>

      <div className="fll" style={{ marginTop: 30 }}>RACES</div>
      <div className="races">
        {seed.races.map((r, i) => (
          <div
            className="rcr"
            key={r.slug + i}
            style={{ cursor: 'pointer' }}
            onClick={() => onOpenRace(r.slug)}
            role="button"
            tabIndex={0}
          >
            <div className="rcn">{r.name}<span className="rcm">{r.meta}</span></div>
            <span className={`rctag ${r.tag === 'A RACE' ? 'rc-goal' : ''}`}>{r.tag}</span>
            <span className="rcd">{r.days}</span>
          </div>
        ))}
      </div>

      {/* Action pills · personal goals + non-run logging. POSTs to
          /api/goals and /api/strength|cross-training respectively.
          Closes coverage lines 1830 (personal goals) + 1847/1863 (non-run logging). */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
        <button
          type="button"
          onClick={() => setGoalOpen(true)}
          style={{
            fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 1.4,
            textTransform: 'uppercase', color: 'var(--bg)', background: 'var(--txt)',
            border: 0, borderRadius: 14, padding: '11px 18px', cursor: 'pointer',
          }}
        >
          + New goal
        </button>
        <button
          type="button"
          onClick={() => setLogOpen(true)}
          style={{
            fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: 1.4,
            textTransform: 'uppercase', color: 'var(--txt)', background: 'rgba(255,255,255,.07)',
            border: '1px solid var(--glass-line)', borderRadius: 14,
            padding: '11px 18px', cursor: 'pointer',
          }}
        >
          + Log strength / cross
        </button>
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
    </>
  );
}

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

function formatDate(iso: string) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}

function formatProjSec(sec: number | null | undefined): string {
  if (sec == null) return '·';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

