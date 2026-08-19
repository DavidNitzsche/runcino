'use client';

import { useEffect, useState } from 'react';
import type { FaffSeed } from '../types';
import { EFF } from '../constants';

/**
 * Weekly check-in overlay · the "WEEK N RECAP" chip in the sidebar.
 *
 * 2026-08-17 · truth fix. The chip labels LAST week (Sidebar renders
 * `WEEK max(1, nowIdx)`), and the totals row already read last week's
 * miles — but the sessions count and the day bars were built from the
 * CURRENT week (seed.week), so the overlay mixed two different weeks
 * in one story. Everything below now reads the recap week
 * (season.weekDays[nowIdx - 1]): bars, sessions, date range, delta
 * (recap week vs the week before it).
 *
 * The "FAFF SAYS" line prefers the coach-log week-closed entry (GET
 * /api/coach/log · kind 'week_close') when a recent one exists — the
 * coach's actual close-of-week read — over today's readiness one-liner,
 * which describes THIS morning, not last week.
 */
export function WeeklyCheckIn({ open, onClose, seed }: { open: boolean; onClose: () => void; seed: FaffSeed }) {
  const nowIdx = seed.season.nowIdx;
  const recapIsCurrent = nowIdx === 0; // no prior plan week yet · recap week 1 itself
  const recapIdx = Math.max(0, nowIdx - 1);
  const seasonDays = seed.season.weekDays[recapIdx] ?? [];

  // Recap-week day rows. Prefer the season grid (real plan data for any
  // week); degrade to the current-week strip only when the season has
  // nothing (plan-less runner).
  const days = seasonDays.length > 0
    ? seasonDays.map((d) => ({
        letter: (d.dow ?? ' ')[0] ?? ' ',
        type: d.type,
        mi: d.mi || 0,
        done: !!d.done,
        date: d.date ?? null,
      }))
    : seed.week.map((d) => ({
        letter: d.dw[0],
        type: d.type,
        mi: parseFloat(d.dist) || 0,
        done: !!d.done,
        date: (d as { iso?: string }).iso ?? null,
      }));

  // Actual miles · recap week vs the week before it. volumeBars are
  // chronological with the current week last, so last week = len-2.
  const bars = seed.volumeBars;
  const recapMi = recapIsCurrent
    ? seed.thisWeekMiles
    : (bars[bars.length - 2]?.mi ?? 0);
  const priorMi = recapIsCurrent
    ? (bars[bars.length - 2]?.mi ?? 0)
    : (bars[bars.length - 3]?.mi ?? 0);
  const delta = Math.round((recapMi - priorMi) * 10) / 10;

  // 2026-08-19 · onboarding QA · "ACTIVE BLOCK" was the fallback for a null
  // goalRace, which is exactly the runner who has NO block: just-run mode
  // and anyone who has not added a race or goal yet. season.weekDays is
  // empty precisely when no plan was authored (seed.ts adaptSeason returns
  // `weekDays: []` for `!training?.weeks?.length`), so it is the honest
  // discriminator between "block, phase unknown" and "no block".
  const hasAuthoredPlan = (seed.season?.weekDays?.length ?? 0) > 0;
  const blockFallback = hasAuthoredPlan ? 'Active block' : 'No plan yet';
  const phaseFull = seed.goalRace?.phaseLabel ?? blockFallback;
  const phaseTop = phaseFull.split(' · ')[0] ?? blockFallback;
  const max = Math.max(1, ...days.map((d) => d.mi));
  const sessionsPlanned = days.filter((d) => d.type !== 'rest' && d.mi > 0).length;
  const sessionsDone = days.filter((d) => d.type !== 'rest' && d.done).length;

  // Recap-week date range for the subtitle (was today's date · wrong week).
  const rangeLabel = (() => {
    const dated = days.map((d) => d.date).filter((x): x is string => !!x);
    if (dated.length === 0) return seed.topDate;
    const fmt = (iso: string) => {
      const p = iso.split('-').map(Number);
      return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    return `${fmt(dated[0])} – ${fmt(dated[dated.length - 1])}`;
  })();

  // Coach's week-closed line. Seed's coachLog strip usually carries it;
  // fetch the log when the overlay opens in case it scrolled past the
  // seed's cap. 10-day recency guard so a months-old close never
  // narrates this recap.
  const freshEnough = (dateISO: string) =>
    Date.now() - Date.parse(dateISO + 'T12:00:00Z') <= 10 * 86400000;
  const seedClose = seed.coachLog.find((e) => e.kind === 'week_close' && freshEnough(e.dateISO));
  const [weekCloseLine, setWeekCloseLine] = useState<string | null>(seedClose?.body ?? null);
  useEffect(() => {
    if (!open || weekCloseLine) return;
    let alive = true;
    fetch('/api/coach/log?limit=20')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j?.ok) return;
        const e = (j.entries as Array<{ kind: string; body: string; dateISO: string }> | undefined)
          ?.find((x) => x.kind === 'week_close' && freshEnough(x.dateISO));
        if (e) setWeekCloseLine(e.body);
      })
      .catch(() => { /* readiness fallback covers it */ });
    return () => { alive = false; };
  }, [open, weekCloseLine]);

  return (
    <div className={`ov${open ? ' open' : ''}`}>
      <div className="ovbg" onClick={onClose} />
      <div className="ovcard weekci">
        <div className="ovx" onClick={onClose} role="button" tabIndex={0}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
        <div className="wc-body">
          <div className="wc-tag">{phaseTop.toUpperCase()}</div>
          <div className="wc-h">{deltaHeadline(delta, recapMi, priorMi)}</div>
          <div className="wc-sub">{rangeLabel}</div>
          <div className="wc-stats">
            <div><div className="v">{recapMi}<small> mi</small></div><div className="k">MILES</div></div>
            <div><div className="v">{sessionsDone}<small>/{sessionsPlanned}</small></div><div className="k">SESSIONS</div></div>
            <div><div className={`v ${delta >= 0 ? 'up' : ''}`}>{delta >= 0 ? '+' : ''}{delta}<small> mi</small></div><div className="k">VS WEEK BEFORE</div></div>
          </div>
          <div className="wc-lbl">{recapIsCurrent ? 'THIS WEEK' : 'LAST WEEK'}</div>
          <div className="wc-week">
            {days.map((d, i) => {
              const dist = d.mi;
              const h = dist > 0 ? Math.round((dist / max) * 100) : 6;
              const c = d.type === 'rest' ? null : EFF[d.type].dot;
              return (
                <div key={i} className={`wc-day${d.done ? '' : (d.type === 'rest' ? '' : ' miss')}`}>
                  {dist > 0 ? (
                    <div className="bar" style={{ height: `${h}%`, background: c ?? 'transparent' }}>
                      {d.done && (
                        // stroke = --green (#3EBD41) · solid good-state done glyph
                        <svg className="chk" viewBox="0 0 24 24" fill="none" stroke="#3EBD41" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                      )}
                    </div>
                  ) : (
                    <div className="bar" style={{ height: '6%', background: 'rgba(255,255,255,.12)' }} />
                  )}
                  <div className="dn">{d.letter}</div>
                  <div className="dm">{dist > 0 ? `${dist} ${d.type}` : 'rest'}</div>
                </div>
              );
            })}
          </div>
          <div className="wc-lbl">FAFF SAYS</div>
          <div className="wc-coach">
            <span className="ct">COACH</span>
            <span className="cx">{weekCloseLine ?? seed.readiness.coach}</span>
          </div>
          {seed.goalRace && (
            <>
              <div className="wc-lbl">RACE WATCH</div>
              <div className="wc-next">
                <div className="wc-nexthero">{seed.goalRace.name}<small>{seed.goalRace.location ? `${seed.goalRace.location} · ` : ''}{formatDate(seed.goalRace.date)}</small></div>
                <div className="wc-nrow"><span className="nk">Goal</span><span className="nv">{seed.goalRace.goal}</span></div>
                <div className="wc-nrow"><span className="nk">Projected</span><span className="nv">{seed.goalRace.projected}</span></div>
                <div className="wc-nrow"><span className="nk">Days out</span><span className="nv">{seed.goalRace.daysAway}</span></div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function deltaHeadline(delta: number, recapMi: number, priorMi: number): React.ReactNode {
  // 2026-08-19 · onboarding QA D8 · a zero delta between two empty weeks is not
  // a held line. "Held the line." implies a streak that was maintained, and it
  // was rendering under NO PLAN YET for a runner who has never logged a mile.
  // Both weeks empty is the one case where the delta says nothing at all.
  if (recapMi === 0 && priorMi === 0) return <>Nothing logged yet.</>;
  if (delta > 5) return <>Pushed the load.</>;
  if (delta > 0) return <>Steady gain.</>;
  if (delta === 0) return <>Held the line.</>;
  if (delta > -5) return <>Soft step back.</>;
  return <>Cutback week.</>;
}
function formatDate(iso: string) {
  // noon-UTC anchor on the date part so the label never shifts a day by timezone.
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(iso.slice(0, 10) + 'T12:00:00Z'));
}
