'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import type { FaffSeed } from '../types';
import { EFF, KIT, ROLECOL, type EffortKey } from '../constants';
import { useGlossaryDrawer } from '../toolkit/GlossaryDrawer';
import { formatRaceTime, parseRaceTime } from '@/lib/training/vdot';

/**
 * 2026-06-04 · per-workout-type gradient for the .hmain hero card.
 * David moved Today's page mesh to neutral charcoal (matches Targets) so
 * the page reads calm + the effort color now lives on the hero card
 * itself.  Picks stops [1] / [3] / [4] from the canonical EFF mesh so a
 * tempo card stays tempo-orange and a recovery card stays cyan-teal —
 * same palette source, just relocated.  Used by all three hero-hmain
 * variants (rest-day, planned, completed).
 */
function meshGradient(type: EffortKey): React.CSSProperties {
  const m = EFF[type].mesh;
  return {
    ['--hg-1' as string]: m[1],
    ['--hg-2' as string]: m[3],
    ['--hg-3' as string]: m[4],
  } as React.CSSProperties;
}
import { buildAdaptText } from '../adapt-text';
import { workoutTypeTitle } from '@/lib/coach/workout-title';
import { heatAwareDrift, type DriftBand } from '@/lib/coach/heat-band';
import { deriveSessionSegs, fallbackSessionSegs, deriveBlueprintData, type BlueprintData, type BlueprintSegment } from '../session-shape';
import { elevPathFromSplits } from '@/lib/route/polyline';
import { CoachProposalCard } from '../cards/CoachProposalCard';
import { PlanProposalCard } from '../cards/PlanProposalCard';
import { WorkoutProposalBanner } from '../cards/WorkoutProposalBanner';
import { RouteMap } from '../RouteMap';
import {
  AdaptationCard,
  DayStatePill,
  ProfileGapCard,
  ReconnectBanner,
} from '../toolkit';

export function TodayView({
  seed, curDay, onPickDay, onOpenDrawer, onOpenRace, onOpenRun,
}: {
  seed: FaffSeed; curDay: number;
  onPickDay: (i: number) => void;
  onOpenDrawer: () => void;
  onOpenRace: () => void;
  onOpenRun?: (id: string) => void;
}) {
  // 2026-06-01 · router refresh path · used by StandingRecAdvisory's
  // Accept handler so a successful POST to /accept-standing reloads
  // the seed (new plan_workouts row + cleared standing rec).
  const router = useRouter();
  // 2026-05-31: per-day skip overrides keyed by ISO date. Initialized
  // from seed (server-side day_actions read in loadWeekSkips), then
  // mutated optimistically by the PlannedHeroV2 Skip/Restore button so
  // the change reflects in the week strip AND the hero without a reload.
  const [skipOverrides, setSkipOverrides] = useState<Record<string, boolean>>({});
  // Week strip navigation. 0 = current week (seed.week). -1 = last week,
  // -2 = two weeks ago, etc. Uses season.weekDays for past/future weeks
  // so no extra API call is needed.
  const [weekOffset, setWeekOffset] = useState(0);
  const isSkipped = (day: typeof seed.week[number]) =>
    (day.iso && day.iso in skipOverrides) ? skipOverrides[day.iso!] : !!day.skipped;
  const setSkippedFor = (iso: string | undefined, next: boolean) => {
    if (!iso) return;
    setSkipOverrides((m) => ({ ...m, [iso]: next }));
  };

  const d = seed.week[curDay] ?? seed.week[seed.todayIdx];
  const { openTerm: openGlossary, drawerEl: glossaryDrawer } = useGlossaryDrawer();
  const e = EFF[d.type];
  const isRest = d.type === 'rest';
  const dSkipped = isSkipped(d);

  // 2026-06-08 · race-day takeover gate. The brief: "Race day. The race
  // takes the page." The reliable signal is the goal race itself, NOT
  // d.type — mapType now returns 'race', but the date+countdown is the
  // authoritative "this is race morning" test and survives any plan-row
  // type drift. Fires only when: the goal race is today (daysAway clamps
  // to 0 the morning of), the SELECTED day is the race date (so tapping
  // back to a prior day in the strip shows that day, not the race), and
  // the race isn't logged yet (once done, Today pivots to the recap).
  const goal = seed.goalRace;
  const isRaceDay = goal != null && goal.daysAway === 0 && !!d.iso && d.iso === goal.date && !d.done;
  const band = seed.readinessBrief?.band ?? null;
  const isPullBack = band === 'pull-back' && !d.done && (d.type === 'easy' || d.type === 'recovery');
  // 2026-06-10 · coached mode (fifth onboarding path): the runner's own
  // coach owns the plan. A plan-less day for a coached runner gets the
  // coached hero (no prescriptions, no workout card) — completed runs
  // still render the normal done hero.
  const isCoachedBlank = seed.coachedExternally && !d.planWorkoutId && !d.done;
  const result = d.done ? (seed.results[curDay] ?? seed.results[0]) : undefined;
  // 2026-05-30: lazy-fetch the real run summary for past days so the hero
  // stats grid + heroExtra row don't render seed.results placeholder "·"
  // values. Shared with WorkoutCard/CompletedResultCard.
  const { data: runData, loading: runLoading } = useRunSummary(d.done ? d.activityId : null);
  // Resolved values prefer the live fetch over the seed placeholder when
  // the fetch has landed. Until it lands we keep the placeholder so the
  // grid doesn't flash empty.
  const resolvedTime    = runData?.time_moving ?? result?.time;
  const resolvedPace    = runData?.pace ?? result?.apace;
  const resolvedHr      = runData?.hr_avg ?? result?.hr;
  const resolvedTempF   = runData?.temp_f ?? null;
  const resolvedTempRange = runData?.temp_range_f ?? null;
  const resolvedGainFt  = runData?.elev_gain_ft != null ? Math.round(runData.elev_gain_ft) : result?.gain;
  const resolvedShoeNm  = (() => {
    if (runData?.shoe_id != null && runData.shoes) {
      const s = runData.shoes.find(x => x.id === runData.shoe_id);
      if (s) return `${s.brand} ${s.model}`.trim();
    }
    return result?.shoe;
  })();

  // ACWR load-band chip removed 2026-06-01 (David call). Will resurface
  // inside readiness once that backend lands; the standalone chip on
  // Today had no in-app explanation and read as noise.

  // "Yesterday missed" detection. When the previous day was planned,
  // not a rest, not done, and not explicitly skipped → surface a
  // DayStatePill with three actions: log a different effort,
  // mark skipped retroactively, or carry forward. Closes coverage
  // line 441.
  const missedYesterday: typeof seed.week[number] | null = (() => {
    if (seed.todayIdx <= 0) return null;
    const y = seed.week[seed.todayIdx - 1];
    if (!y) return null;
    if (y.done || y.skipped || y.type === 'rest') return null;
    return y;
  })();

  // T2 physiology auto-nudge · David decision 2026-05-31. Skip the
  // dedicated onboarding Step 1c entirely; instead, after 3 days of
  // use, if the runner has no LTHR / HRmax / weight + no AppleHealth
  // connected, fire a ProfileGapCard on Today pointing at Health.
  // Closes coverage row 1647 (T2 physiology signals step).
  const [showPhysiologyNudge, setShowPhysiologyNudge] = useState(false);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);
  useEffect(() => {
    if (nudgeDismissed) return;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('physiologyNudgeDismissed') === '1') {
      setNudgeDismissed(true);
      return;
    }
    let alive = true;
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive || !j) return;
        const hasPhysiology = (j.lthr != null) || (j.hrmax_observed != null) || (j.hrmax != null) || (j.height_cm != null);
        const healthConnected = !!j.health_connected_at;
        const onboardedAt = j.onboarded_at ? new Date(j.onboarded_at) : null;
        const daysSinceOnboard = onboardedAt && Number.isFinite(onboardedAt.getTime())
          ? (Date.now() - onboardedAt.getTime()) / 86400000
          : Infinity;
        // Fire only when: no physiology AND no AppleHealth AND ≥3 days post-onboard
        if (!hasPhysiology && !healthConnected && daysSinceOnboard >= 3) {
          setShowPhysiologyNudge(true);
        }
      })
      .catch(() => { /* silent */ });
    return () => { alive = false; };
  }, [nudgeDismissed]);

  return (
    <>
      <div className="top">
        <div>
          <div className="date">{d.full}</div>
          <div className="wk">{seed.weekOf}</div>
        </div>
        {(() => {
          // 2026-06-01 · Today header reads from seed.readinessBrief
          // first · same source as the drawer. Previously the chip
          // showed seed.readiness.score (legacy adaptReadiness output)
          // while the drawer showed seed.readinessBrief.score, so the
          // two surfaces could disagree. Brief is the source of truth;
          // legacy readiness is the fallback only when brief is null
          // (no-data band, fresh runner, composer error). Ring stroke
          // is also band-aware now · was hardcoded green so a pull-
          // back day showed a green ring with "PULL BACK" copy.
          const score = seed.readinessBrief?.score ?? seed.readiness.score;
          const label = seed.readinessBrief?.label ?? seed.readiness.label;
          const band = seed.readinessBrief?.band ?? null;
          // AFC fix 2 · sharp + ready collapse to the single good-state
          // green from the locked palette. #34D058 was a one-off green
          // visually indistinguishable from #3EBD41 at ring size.
          const ringColor =
            band === 'sharp' ? '#3EBD41' :
            band === 'ready' ? '#3EBD41' :
            band === 'moderate' ? '#F3AD38' :
            band === 'pull-back' ? '#FC4D64' :
            band === 'no-data' ? '#8A90A0' :
            '#3EBD41';
          return (
            <div className="rbtn" onClick={onOpenDrawer} role="button" tabIndex={0}>
              <div className="rt">
                <div className="rl">
                  READINESS{' '}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </div>
                <div className="rs" style={band ? { color: ringColor } : undefined}>{label}</div>
              </div>
              <div className="ringwrap">
                <svg width="56" height="56" viewBox="0 0 56 56">
                  <circle cx="28" cy="28" r="23" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="5"/>
                  <circle cx="28" cy="28" r="23" fill="none" stroke={ringColor} strokeWidth="5" strokeLinecap="round" strokeDasharray="144.5" strokeDashoffset={144.5 - (score / 100) * 144.5} transform="rotate(-90 28 28)"/>
                </svg>
                {/* Cold-start: no biometric data yet → a "0" score reads as
                    broken. Show an em-dash; the "BUILDING" label carries
                    the honest state. */}
                <div className="rv">{band === 'no-data' ? '—' : score}</div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* 2026-06-04 · ALL wrapper divs + inline marginTop removed.
          Each banner / proposal card renders directly into the .main
          grid · components return null when they have nothing to
          show.  .main's --section-gap handles spacing when something
          IS rendered.  Previously every wrapper div made an empty
          grid row + carried inline margin = ~60-100px of dead space
          above THIS WEEK when none of these had content (David: "way
          too much dead space up here, the rules were either not
          enforced or too lax").

          Brief v2 §6 (queued task 3, 2026-06-09) · ONE-BANNER CAP.
          The .prehero-stack wrapper is display:contents (children stay
          direct grid items) and CSS hides every element after the
          first, so at most ONE interruption renders above the hero
          regardless of how many components have content. DOM order =
          priority: reconnect → adaptation → physiology nudge → missed
          yesterday → coach proposals → plan proposals → workout
          proposals. Null-rendering components contribute no element,
          so :first-child is always the highest-priority banner that
          actually fired. ReconnectBanner moved inside the stack (it
          was above the header and outside any cap). */}

      <div className="prehero-stack">
      <ReconnectBanner />
      <AdaptationCard />

      {showPhysiologyNudge ? (
        <ProfileGapCard
          highlight="Tell Faff your LTHR + HRmax"
          fragment="so the coach can dial in your zones. Takes ~30 seconds."
          ctaLabel="ADD"
          ctaHref="/health"
          onCta={() => {
            if (typeof localStorage !== 'undefined') {
              localStorage.setItem('physiologyNudgeDismissed', '1');
            }
            setNudgeDismissed(true);
            setShowPhysiologyNudge(false);
          }}
        />
      ) : null}

      {missedYesterday ? (
        <DayStatePill
          kind="missed"
          label={`Yesterday's ${missedYesterday.name.toLowerCase()} · ${missedYesterday.dist} mi`}
          actions={[
            {
              label: 'LOG IT',
              onClick: () => { onPickDay(seed.todayIdx - 1); },
            },
            {
              label: 'SKIP',
              onClick: () => {
                if (!missedYesterday.iso) return;
                void fetch('/api/today/skip', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ date: missedYesterday.iso, skip: true }),
                }).then(() => { setSkippedFor(missedYesterday.iso, true); });
              },
            },
          ]}
        />
      ) : null}

      {seed.pendingProposals.length > 0
        ? seed.pendingProposals.map((p) => (
            <CoachProposalCard key={p.id} proposal={p} />
          ))
        : null}

      {seed.planProposals && seed.planProposals.length > 0 ? (
        <>
          {seed.planProposals
            .filter((p) => p.status === 'pending')
            .map((p) => <PlanProposalCard key={`pp-${p.id}`} proposal={p} />)}
          {seed.planProposals
            .filter((p) => p.status === 'auto_applied')
            .map((p) => <PlanProposalCard key={`pp-${p.id}`} proposal={p} />)}
        </>
      ) : null}

      {(seed.pendingWorkoutProposals?.length ?? 0) > 0
        ? seed.pendingWorkoutProposals!.map((p) => (
            <WorkoutProposalBanner key={`wp-${p.id}`} proposal={p} />
          ))
        : null}
      </div>{/* .prehero-stack · brief v2 §6 one-banner cap */}

      {/* Morning brief content moved 2026-06-01 into the redesigned
          Readiness drawer (overlays/Drawer.tsx). The inline panel that
          rendered the same data on Today is removed · same data now
          surfaces in one place when the runner taps the readiness ring.
          See designs/from Design agent/readiness-drawer/. */}

      {/* 2026-06-04 · label + week strip wrapped in a .band so the
          label-to-week distance is the tight --label-gap, while the
          band-to-next-band distance stays --section-gap from .main's
          grid.  Same two-tier rhythm spec David defined for inside-card
          field/section spacing, just applied to the page body.

          Brief v2 §6 (queued task 3) · race morning hides the week
          strip entirely — "the race takes the page" means no secondary
          week context above the hero. Every other day renders the
          strip unchanged. */}
      {isRaceDay ? null : (
      <div className="band">
      {/* Week label + prev/next navigation arrows */}
      {(() => {
        const nowIdx = seed.season.nowIdx;
        const totalWeeks = seed.season.weekDays.length;
        const canBack = weekOffset > -(nowIdx);
        const canFwd  = weekOffset < (totalWeeks - 1 - nowIdx);
        // Derive a readable week label for offset weeks
        let stripLabel = 'THIS WEEK';
        if (weekOffset !== 0) {
          const offsetDays = seed.season.weekDays[nowIdx + weekOffset];
          if (offsetDays && offsetDays.length > 0) {
            const first = offsetDays[0];
            const last  = offsetDays[offsetDays.length - 1];
            const fmt = (iso: string | undefined) => {
              if (!iso) return '';
              const p = iso.split('-').map(Number);
              return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            };
            stripLabel = `${fmt(first.date)} – ${fmt(last.date)}`;
          }
        }
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="weeklab" style={{ flex: 1 }}>{stripLabel}</div>
            <button
              onClick={() => { setWeekOffset(o => o - 1); }}
              disabled={!canBack}
              style={{ background: 'none', border: 'none', cursor: canBack ? 'pointer' : 'default', opacity: canBack ? 1 : 0.25, color: 'rgba(255,255,255,.7)', padding: '2px 6px', fontSize: 16, lineHeight: 1 }}
              aria-label="Previous week"
            >‹</button>
            <button
              onClick={() => { setWeekOffset(o => o + 1); }}
              disabled={!canFwd}
              style={{ background: 'none', border: 'none', cursor: canFwd ? 'pointer' : 'default', opacity: canFwd ? 1 : 0.25, color: 'rgba(255,255,255,.7)', padding: '2px 6px', fontSize: 16, lineHeight: 1 }}
              aria-label="Next week"
            >›</button>
          </div>
        );
      })()}
      {/* 2026-06-01 · This Week strip · Direction A redesign per
          designs/from Design agent/week-strip/README.md. Fixed-height
          card (152px) with reserved 16px meta row at the bottom so
          annotations (adapted "was X", strength glyph, done glyph)
          never make a card taller than its neighbors. The strength
          row is demoted from a separate text line to a top-right
          dumbbell glyph in the icon cluster. Adaptation line lives
          in the bottom meta row · only renders when original label
          actually differs from current (no-op suppression per spec).
          2026-06-07 · weekOffset navigation: offset 0 = current week
          (seed.week, full fidelity). Other offsets use season.weekDays
          entries — same plan data, slimmer shape — done days show the
          green check and clicking opens the RunDetailModal. */}
      <div className="week wkstrip-v2">
        {weekOffset === 0 ? seed.week.map((day, i) => {
          const skipped = isSkipped(day);
          const isRest = day.type === 'rest';

          // Adaptation detection · shared with TrainView's FULL PLAN
          // grid via lib/adapt-text. David call 2026-06-01: surface
          // ALL changes including distance ("an easy run can change
          // to a shorter or longer easy run"), not just label flips.
          // The helper applies a 0.25 mi tolerance to absorb rounding
          // noise + case-normalizes labels so no-op rewrites stay
          // silent.
          const wasText = skipped ? null : buildAdaptText(day.adaptation, {
            type: day.type,
            name: day.name,
            subLabel: day.subLabel,
            dist: day.dist,
            iso: (day as { iso?: string; date?: string }).iso ?? (day as { iso?: string; date?: string }).date ?? null,
          });
          const wasAdapted = !!wasText;
          // 2026-06-03 · Rule 14 · removed `!day.done` filter. Hard-with-
          // hard doctrine (Pfitz Advanced Marathoning Appx A) says PM
          // strength after AM quality run is the canonical placement ·
          // run-done doesn't preclude strength. Chip now hides only on
          // skipped days. Tomorrow's chip auto-recomputes when today
          // passes (date moves out of the week).
          // 2026-06-11 · show the glyph when strength is recommended OR
          // already logged that day. Once the weekly count is met the
          // recommender stops recommending (so the day is no longer
          // "suggested"), but the logged day must still show its green
          // done state · otherwise a completed session would vanish.
          const showStrength = (!!day.strengthSuggested || !!day.strengthDone) && !skipped;
          // 2026-06-03 · per-day done state from strength_sessions
          // reconcile · flips chip when HK push or manual log lands.
          // Source: glance.strengthWeekStatus.{confirmed,bonus}.
          const strengthDone = !!day.strengthDone;
          const showDone = !!day.done && !skipped;
          return (
            <button
              key={i}
              className={`wc${i === curDay ? ' on' : ''}${day.today ? ' today' : ''}${skipped ? ' skipped' : ''}${isRest ? ' rest' : ''}`}
              onClick={() => onPickDay(i)}
              type="button"
            >
              {/* Top row · day label + date · icon cluster */}
              <div className="wc-top">
                <span className="wc-day">
                  <span className="wc-dw">{day.today ? 'TODAY' : day.dw}</span>
                  <b className="wc-dn">{day.dn}</b>
                </span>
                <span className="wc-ic">
                  {showStrength ? (
                    strengthDone ? (
                      <span className="gly str strdone" title="Strength logged" aria-label="Strength logged">
                        {/* 2026-06-11 · done = the dumbbell simply turns green
                            (.strdone · David call). Dropped the check overlay;
                            the green icon IS the "logged" signal. */}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/>
                        </svg>
                      </span>
                    ) : (
                      <span className="gly str" title="Strength add-on" aria-label="Strength add-on">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/>
                        </svg>
                      </span>
                    )
                  ) : null}
                  {showDone ? (
                    <span className="gly done" title="Done" aria-label="Done">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5"/>
                      </svg>
                    </span>
                  ) : null}
                </span>
              </div>

              {/* Run name · effort dot + name. Normalize to title case
                  so backend-uppercase labels like "THRESHOLD" render as
                  "Threshold" matching design. Multi-word names (e.g.
                  "Long Run") capitalize each word. */}
              <div className="wc-name">
                {isRest ? null : (
                  <span className="effdot" style={{ background: EFF[day.type].dot }} aria-hidden="true" />
                )}
                <span className="wc-nm">{isRest ? 'Rest' : toTitleCase(workoutTypeTitle(day.type))}</span>
              </div>

              {/* Metrics · "{dist} · {pace}" or "rest" */}
              <div className="wc-met">
                {/* 2026-06-02 · David call: rest-day chip was rendering
                    "Rest" (title) + "rest" (meta) · duplicate. The title
                    above already says it. Empty meta row on rest days
                    keeps the card height aligned with the strip. */}
                {isRest ? null : day.dist === ' · ' ? <span className="wc-met-rest">·</span> : `${day.dist} mi · ${day.pace}`}
              </div>

              {/* Spacer to push meta to bottom */}
              <div className="wc-grow" />

              {/* Meta row · always present (height reserved). Shows
                  the adaptation line, or SKIPPED, or stays empty. */}
              <div className="wc-meta">
                {skipped ? (
                  <span className="wc-skipped">SKIPPED</span>
                ) : wasAdapted && wasText ? (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#F3AD38" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="wc-was-icn">
                      <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>
                    </svg>
                    <span className="wc-was-tx">{wasText}</span>
                  </>
                ) : null}
              </div>
            </button>
          );
        }) : (() => {
          // Past / future week from season.weekDays
          const nowIdx = seed.season.nowIdx;
          const offsetDays = seed.season.weekDays[nowIdx + weekOffset] ?? [];
          const DOW_SHORT = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
          return offsetDays.map((day, i) => {
            const t = day.type;
            const isRest = t === 'rest';
            const isDone = !!day.done;
            const mi = day.mi > 0 ? day.mi.toFixed(1) : null;
            const ps = day.paceSec;
            const paceStr = ps ? `${Math.floor(ps/60)}:${String(Math.round(ps%60)).padStart(2,'0')}` : null;
            const dn = day.date ? (() => { const p = (day.date as string).split('-').map(Number); return new Date(p[0],p[1]-1,p[2]).getDate(); })() : i + 1;
            return (
              <button
                key={i}
                className={`wc${isRest ? ' rest' : ''}`}
                type="button"
                onClick={() => {
                  if (isDone && day.activityId && onOpenRun) onOpenRun(day.activityId as string);
                }}
                style={{ cursor: isDone && day.activityId ? 'pointer' : 'default' }}
              >
                <div className="wc-top">
                  <span className="wc-day">
                    <span className="wc-dw">{DOW_SHORT[i] ?? ''}</span>
                    <b className="wc-dn">{dn}</b>
                  </span>
                  <span className="wc-ic">
                    {isDone ? (
                      <span className="gly done" aria-label="Done">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="wc-name">
                  {isRest ? null : <span className="effdot" style={{ background: EFF[t]?.dot ?? '#8A90A0' }} aria-hidden="true" />}
                  <span className="wc-nm">{isRest ? 'Rest' : toTitleCase(workoutTypeTitle(t))}</span>
                </div>
                <div className="wc-met">
                  {isRest ? null : (mi && paceStr) ? `${mi} mi · ${paceStr}` : mi ? `${mi} mi` : null}
                </div>
                <div className="wc-grow" />
                <div className="wc-meta" />
              </button>
            );
          });
        })()}
      </div>
      </div>
      )}{/* .band · hidden on race morning per brief v2 §6 */}

      {/* Strength-recommender reason banner removed 2026-06-01 (David
          call · "why are we making a banner for strength at all"). The
          chip-level "+ STRENGTH" annotation is the single surface;
          the dormant-runner coach intent flows through the existing
          /api/coach/intents stream (CoachActivityTimeline). The full
          recommendation envelope still rides on the seed and is
          available to other consumers · just no longer surfaces as
          standalone chrome on Today. */}

      {/* 2026-06-11 · the weekly "X/Y this week" strength status chip was
          removed here (David call). Strength completion now reads off a
          single signal · the per-day dumbbell glyph in the week strip turns
          green when a session is logged on that day (see .strdone). No
          separate counter line. */}

      {/* 2026-05-31: hero v2 — done days use CompletedHeroV2 (Post-Run
          Detail (Easy)), planned-and-not-rest days use PlannedHeroV2
          (Run Detail Planned (Easy)). Rest days keep the simple Recovery
          panel below for now. */}
      {isRaceDay ? (
        <RaceDayHero goal={goal!} onOpenRace={onOpenRace} />
      ) : d.done && !isRest ? (
        <CompletedHeroV2
          d={d}
          result={result}
          runData={runData}
          runLoading={runLoading}
          resolvedTime={resolvedTime}
          resolvedPace={resolvedPace}
          resolvedHr={resolvedHr}
          resolvedTempF={resolvedTempF}
          resolvedTempRange={resolvedTempRange}
          resolvedGainFt={resolvedGainFt ?? undefined}
          resolvedShoeNm={resolvedShoeNm ?? undefined}
          shoes={seed.shoes}
          seedShoe={(seed.todayShoeId != null
            ? seed.shoes.find(s => s.id === seed.todayShoeId)?.nm
            : null) ?? seed.shoeRecByType[d.type] ?? null}
          persistShoe={curDay === seed.todayIdx}
        />
      ) : isPullBack ? (
        <div className="hero">
          <div className="hmain" style={meshGradient('recovery')}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <div className="htitle">{seed.readinessBrief!.score}</div>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', opacity: 0.75 }}>{seed.readinessBrief!.label}</div>
            </div>
            {seed.readinessBrief!.oneLineMover && (
              <div className="rest-coach">{seed.readinessBrief!.oneLineMover}</div>
            )}
            <div className="stats">
              {(() => {
                const sleepTile = seed.health.body.find(m => m.k === 'sleep');
                const sleepSeries = sleepTile?.series ?? [];
                const lastNight = sleepSeries.length ? sleepSeries[sleepSeries.length - 1] : null;
                const avg7 = sleepTile?.current ?? null;
                const rhrTile = seed.health.body.find(m => m.k === 'rhr');
                const rhrCur = rhrTile?.current ?? null;
                const rhrBase = rhrTile?.target ?? null;
                const hrvTile = seed.health.body.find(m => m.k === 'hrv');
                const hrvCur = hrvTile?.current ?? null;
                const hrvBase = hrvTile?.target ?? null;
                // 2026-06-10 · cold start. A brand-new runner with no
                // HealthKit data was shown three empty tiles ("· bpm /
                // · ms / 0.0h") that read as a broken card (David). When
                // there's no biometric data at all, show one honest
                // connect prompt instead of empty placeholders.
                // Falsy (null/0) all-around = no real biometrics: a
                // cold-start runner reads avg7 as 0.0h, not null.
                if (!lastNight && !avg7 && !rhrCur && !hrvCur) {
                  return (
                    <div style={{ gridColumn: '1 / -1', opacity: 0.6, fontSize: 12.5, lineHeight: 1.5 }}>
                      Connect Apple Health to track sleep, resting HR, and HRV. Until then, Faff coaches off your runs.
                    </div>
                  );
                }
                return (
                  <>
                    <div>
                      <div className="v">{formatSleep(lastNight ?? avg7 ?? undefined)}</div>
                      <div className="k">LAST NIGHT</div>
                      {avg7 != null && (
                        <div style={{ fontSize: 9.5, opacity: 0.55, marginTop: 2 }}>
                          {avg7.toFixed(1)}h · 7-night avg
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="v">{Math.round(rhrCur ?? 0) || '·'}<small> bpm</small></div>
                      <div className="k">RESTING HR</div>
                      {rhrBase != null && rhrCur != null && (
                        <div style={{ fontSize: 9.5, opacity: 0.55, marginTop: 2 }}>
                          baseline {Math.round(rhrBase)} · {rhrCur - rhrBase >= 0 ? '+' : ''}{Math.round(rhrCur - rhrBase)}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="v">{Math.round(hrvCur ?? 0) || '·'}<small> ms</small></div>
                      <div className="k">HRV</div>
                      <button type="button" className="fa-term-explain" style={{ display: 'block', marginTop: 3 }} onClick={() => openGlossary('HRV')}>WHY</button>
                      {hrvBase != null && hrvCur != null && (
                        <div style={{ fontSize: 9.5, opacity: 0.55, marginTop: 2 }}>
                          baseline {Math.round(hrvBase)} · {Math.round((hrvCur - hrvBase) / hrvBase * 100) >= 0 ? '+' : ''}{Math.round((hrvCur - hrvBase) / hrvBase * 100)}%
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
          {(() => {
            const mover = seed.readinessBrief!.oneLineMover ?? seed.readinessBrief!.headline;
            const cap = d.hrCap;
            const capPart = cap ? ` (${cap} bpm)` : '';
            return (
              <div style={{ fontSize: 12, opacity: 0.6, padding: '10px 0 2px', lineHeight: 1.5 }}>
                {mover}. Run this by the HR cap{capPart}, not pace.
              </div>
            );
          })()}
          <WorkoutCard
            d={d}
            done={false}
            result={result}
            runData={runData}
            runLoading={runLoading}
            shoes={seed.shoes}
            seedShoe={(seed.todayShoeId != null
              ? seed.shoes.find(s => s.id === seed.todayShoeId)?.nm
              : null) ?? seed.shoeRecByType[d.type] ?? null}
            persistShoe={curDay === seed.todayIdx}
            seed={seed}
          />
        </div>
      ) : !isRest ? (
        <>
          <PlannedHeroV2
            d={d}
            shoes={seed.shoes}
            seedShoe={(seed.todayShoeId != null
              ? seed.shoes.find(s => s.id === seed.todayShoeId)?.nm
              : null) ?? seed.shoeRecByType[d.type] ?? null}
            persistShoe={curDay === seed.todayIdx}
            cadenceBaseline={seed.health.body.find(m => m.k === 'cadence')?.current ?? null}
            skipped={dSkipped}
            onToggleSkip={setSkippedFor}
          />

          {/* 2026-06-01 · standing recommendation advisory · per
              designs/briefs/standing-recommendation-after-override-landed.md.
              Live engine re-evaluation against today's readiness · only
              renders when the engine would currently recommend a different
              prescription than the active row. Forward counsel, not history.
              Cooler tone than the amber "was X" history banner. Severity
              styles the left edge (advisory = blue, firm = warn). Read-only
              for now · the dedicated Accept endpoint is queued in a separate
              brief and will land the action wiring. */}
          {/* 2026-06-03 · StandingRecAdvisory GUTTED per David: "my
              target wasn't 30min. I didn't accept that. I did the
              plan. I don't love anything about this rating system or
              reacting to it or coach advice to run 30 or something."
              The standing advice was the planned-day surface that
              said "Coach still recommends easing this run · Composite
              readiness in pull-back band · COACH SUGGESTS · EASY · 8
              MI" on a tempo day. Now hidden · the plan stands
              regardless of readiness band. Engine code intact for
              future re-enable as an optional layer. */}
          {false && (
            <StandingRecAdvisory
              rec={d.standingRecommendation}
              workoutId={d.planWorkoutId ?? null}
              hidden={dSkipped}
              onAccepted={() => router.refresh()}
            />
          )}
        </>
      ) : (
        <div className="hero">
          <div className="hmain" style={meshGradient(d.type)}>
            {/* 2026-06-03 · David: drop the small "DAY · TYPE · STATE"
                eyebrow · same info as the week strip + the title itself,
                pure repetition. Title now sits at the top of the column
                aligned with the route + recap cards' top edges. */}
            <div className="htitle">{isCoachedBlank ? 'COACHED' : workoutTypeTitle(d.type)}</div>
            {/* 2026-06-04 · rest-day coach line · gives the card real
                content for its grid-stretched height instead of leaving
                empty space below the stats.  Pulled from KIT.rest.coach
                so the copy stays in the canonical effort kit.
                2026-06-10 · coached mode swaps the line: Faff doesn't
                prescribe for runners whose own coach owns the plan.
                When their calendar feed carries a workout for this day,
                show it verbatim (read-only · their coach's words). */}
            {isCoachedBlank && d.coachWorkout ? (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.6px', opacity: 0.62 }}>FROM YOUR COACH</div>
                <div style={{ fontSize: 19, fontWeight: 700, marginTop: 5, lineHeight: 1.25 }}>{d.coachWorkout.title}</div>
                {d.coachWorkout.description && (
                  <div className="rest-coach" style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflow: 'auto' }}>
                    {d.coachWorkout.description}
                  </div>
                )}
              </div>
            ) : (
              <div className="rest-coach">{isCoachedBlank
                ? 'Your coach owns the plan. Faff tracks the work. Runs land here from your watch or Strava.'
                : KIT.rest.coach}</div>
            )}
            {/* 2026-06-10 · the calendar-link paste UI moved to Settings ›
                Connections (David: "why would they paste the training
                peaks link here? that should be in settings"). The hero
                keeps only a quiet pointer when no calendar is connected
                yet. */}
            {isCoachedBlank && !seed.coachCalendar?.urlSet && (
              <div className="rest-coach" style={{ opacity: 0.62, fontSize: 12.5 }}>
                Using Final Surge or TrainingPeaks? Add your coach&rsquo;s calendar in Settings › Connections.
              </div>
            )}
            <div className="stats">
              {/* 2026-06-03 · subtitles added per David: "not sure what
                  it means for 6:06 hours sleep. Seems wrong." The value
                  was 7-night avg shown without context next to today's
                  RHR/HRV · runner couldn't tell what time horizon each
                  number represented. Now: each value carries a tiny
                  subtitle (7-NIGHT AVG / vs baseline). */}
              {(() => {
                const sleepTile = seed.health.body.find(m => m.k === 'sleep');
                const sleepSeries = sleepTile?.series ?? [];
                const lastNight = sleepSeries.length ? sleepSeries[sleepSeries.length - 1] : null;
                const avg7 = sleepTile?.current ?? null;
                const rhrTile = seed.health.body.find(m => m.k === 'rhr');
                const rhrCur = rhrTile?.current ?? null;
                const rhrBase = rhrTile?.target ?? null;
                const hrvTile = seed.health.body.find(m => m.k === 'hrv');
                const hrvCur = hrvTile?.current ?? null;
                const hrvBase = hrvTile?.target ?? null;
                // 2026-06-10 · cold start. A brand-new runner with no
                // HealthKit data was shown three empty tiles ("· bpm /
                // · ms / 0.0h") that read as a broken card (David). When
                // there's no biometric data at all, show one honest
                // connect prompt instead of empty placeholders.
                // Falsy (null/0) all-around = no real biometrics: a
                // cold-start runner reads avg7 as 0.0h, not null.
                if (!lastNight && !avg7 && !rhrCur && !hrvCur) {
                  return (
                    <div style={{ gridColumn: '1 / -1', opacity: 0.6, fontSize: 12.5, lineHeight: 1.5 }}>
                      Connect Apple Health to track sleep, resting HR, and HRV. Until then, Faff coaches off your runs.
                    </div>
                  );
                }
                return (
                  <>
                    <div>
                      <div className="v">{formatSleep(lastNight ?? avg7 ?? undefined)}</div>
                      <div className="k">LAST NIGHT</div>
                      {avg7 != null && (
                        <div style={{ fontSize: 9.5, opacity: 0.55, marginTop: 2 }}>
                          {avg7.toFixed(1)}h · 7-night avg
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="v">{Math.round(rhrCur ?? 0) || '·'}<small> bpm</small></div>
                      <div className="k">RESTING HR</div>
                      {rhrBase != null && rhrCur != null && (
                        <div style={{ fontSize: 9.5, opacity: 0.55, marginTop: 2 }}>
                          baseline {Math.round(rhrBase)} · {rhrCur - rhrBase >= 0 ? '+' : ''}{Math.round(rhrCur - rhrBase)}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="v">{Math.round(hrvCur ?? 0) || '·'}<small> ms</small></div>
                      <div className="k">HRV</div>
                      <button type="button" className="fa-term-explain" style={{ display: 'block', marginTop: 3 }} onClick={() => openGlossary('HRV')}>WHY</button>
                      {hrvBase != null && hrvCur != null && (
                        <div style={{ fontSize: 9.5, opacity: 0.55, marginTop: 2 }}>
                          baseline {Math.round(hrvBase)} · {Math.round((hrvCur - hrvBase) / hrvBase * 100) >= 0 ? '+' : ''}{Math.round((hrvCur - hrvBase) / hrvBase * 100)}%
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
          {/* Coached mode: no workout card · there is no Faff workout. */}
          {!isCoachedBlank && (
            <WorkoutCard
              d={d}
              done={false}
              result={result}
              runData={runData}
              runLoading={runLoading}
              shoes={seed.shoes}
              seedShoe={(seed.todayShoeId != null
                ? seed.shoes.find(s => s.id === seed.todayShoeId)?.nm
                : null) ?? seed.shoeRecByType[d.type] ?? null}
              persistShoe={curDay === seed.todayIdx}
              seed={seed}
            />
          )}
        </div>
      )}

      {/* 2026-06-08 · tiles recede on race morning · the race takes the
          page. GAP/RACE-DAY/VOLUME/FORM all live one tap away in the full
          race plan (and on Targets); on the day, they're noise. */}
      {isRaceDay ? null : <Tiles seed={seed} onOpenRace={onOpenRace} />}
      {glossaryDrawer}
    </>
  );
}

type RunSummary = {
  pace: string | null; time_moving: string | null;
  hr_avg: number | null; hr_max: number | null;
  elev_gain_ft: number | null;
  temp_f: number | null;
  /** Thermal arc from fetchRunWeatherSpan · start/end/peak/mean temps
   *  across the run's duration. RunDetailModal already shows this as
   *  "65°F → 77°F" when start↔end differs ≥3°F. 2026-06-02 wires it
   *  to the post-run hero too · was a gap noted by David. */
  temp_range_f?: { start: number | null; end: number | null; peak: number | null; mean: number | null } | null;
  power_avg_w: number | null;
  shoe_id: number | null;
  shoes?: Array<{ id: number; brand: string; model: string }>;
  /** A5 — GPS splits flagged unreliable at ingest; gate MILE SPLITS display. */
  splits_unreliable?: boolean;
  splits: Array<{ mile: number; pace: string | null; elev_change_ft: number | null; hr?: number | null }>;
  route_polyline?: string | null;
  distance_mi?: number;
  hrZonePcts?: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;
  /** "Hotter than usual" context computed by run-state.ts vs the runner's
   *  14-day baseline at this lat/lon. Set when the delta is ≥8°F. */
  weather_context?: { message: string; hr_bump_bpm: number } | null;
  /** 2026-06-04 · duration-scaled Maughan/Vihma heat slowdown % for this
   *  run · used to render a faded heat-adjusted band on the pace bars
   *  so the runner can see when their actual pace was "on plan given
   *  the conditions" vs honestly off. Same value drives the heat-
   *  adjusted phase verdict. 0 when conditions weren't material. */
  heat_slowdown_pct?: number | null;
  /** 2026-06-08 · heat-adjusted KEPT-IT-EASY share (Z1+Z2 %) · non-null only
   *  on hot runs (heat_slowdown_pct >= 6). The easy gauge prefers it over the
   *  raw share so thermoregulation isn't scored as a failure. */
  easy_share_heat_adj?: number | null;
  /** Phase-by-phase breakdown from coach_intents watch_completion payload.
   *  Drives THE REPS card for intervals · warmup/cooldown/recovery rows
   *  + per-rep plan-vs-result bars. Empty array for Strava/HK runs that
   *  weren't piloted by Faff watch. 2026-06-02 wired through. */
  phase_breakdown?: Array<{
    index: number;
    label: string;
    type: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'unknown';
    target_pace: string | null;
    /** raw s/mi + ±band · drive the per-mile range bar (iPhone parity).
     *  Produced by loadPhaseBreakdown (run-state.ts; work default ±8s);
     *  absent on older cached payloads, so optional. */
    target_pace_sec?: number | null;
    tolerance_pace_sec?: number | null;
    target_distance_mi: number | null;
    target_duration_sec: number | null;
    actual_pace: string | null;
    actual_distance_mi: number | null;
    actual_duration_sec: number | null;
    avg_hr: number | null;
    max_hr: number | null;
    avg_cadence: number | null;
    completed: boolean;
    status: 'on' | 'fast' | 'slow' | null;
  }>;
};

/** Coach-derived "WHY THIS RUN" payload from /api/today/purpose. */
type PurposePayload = {
  verdict: string;
  facts: string[];
  /** 2026-06-02 · single-source-of-truth one-word hero title shared
   *  with iPhone + watch. Server resolves from the workout type via
   *  lib/coach/workout-title.ts. e.g. "INTERVALS" / "TEMPO" / "EASY".
   *  Optional · falls back to PlannedDay.name when missing on older
   *  responses (30-min cache cycle). */
  typeTitle?: string;
};
/** Coach-derived "WHAT THIS RUN DID" payload from /api/runs/[id]/recap. */
type RecapPayload = {
  verdict: string;
  facts: string[];
  coach_tip: string | null;
  conditions_note: string | null;
};

/** Fetch the pre-run "why this run" payload for a given date · the engine
 *  derives verdict + facts + citations from workout type + phase + race
 *  context. Replaces the hardcoded planVerdict/planRecap strings; falls
 *  back to those when the fetch hasn't landed yet so the UI never blanks. */
function useTodayPurpose(dateIso: string | undefined): { data: PurposePayload | null; loading: boolean } {
  const [data, setData] = useState<PurposePayload | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!dateIso) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/today/purpose?date=${encodeURIComponent(dateIso)}`)
      .then(r => r.ok ? r.json() : null)
      .then((j: any) => {
        if (cancelled || !j || j.ok !== true) return;
        setData({ verdict: j.verdict, facts: j.facts ?? [] });
      })
      .catch(() => { /* swallow · fallback string covers it */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dateIso]);
  return { data, loading };
}

/** Fetch the post-run "what this run did" payload for a completed run.
 *  Includes heat-aware conditions_note + forward-looking coach_tip when
 *  conditions were material. Falls back silently when the fetch fails. */
function useRunRecap(activityId: string | null | undefined): { data: RecapPayload | null; loading: boolean } {
  const [data, setData] = useState<RecapPayload | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!activityId) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/runs/${encodeURIComponent(activityId)}/recap`)
      .then(r => r.ok ? r.json() : null)
      .then((j: any) => {
        if (cancelled || !j || j.ok !== true) return;
        setData({
          verdict: j.verdict,
          facts: j.facts ?? [],
          coach_tip: j.coach_tip ?? null,
          conditions_note: j.conditions_note ?? null,
        });
      })
      .catch(() => { /* swallow · existing deriveRecap fallback handles UI */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activityId]);
  return { data, loading };
}

/** Lazy-fetch /api/runs/[id] for a past day. Shared by the TodayView hero
 *  stats grid AND the WorkoutCard's CompletedResultCard so both surfaces
 *  show real numbers (instead of seed.results placeholder · symbols). */
function useRunSummary(activityId: string | null | undefined): { data: RunSummary | null; loading: boolean } {
  const [data, setData] = useState<RunSummary | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!activityId) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/runs/${encodeURIComponent(activityId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((j: RunSummary | null) => { if (!cancelled && j) setData(j); })
      .catch(() => { /* swallow */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activityId]);
  return { data, loading };
}

function CompletedResultCard({ d, fallback, runData, loading }: { d: FaffSeed['week'][number]; fallback?: FaffSeed['results'][number]; runData: RunSummary | null; loading: boolean }) {
  const data = runData;
  const splits = data?.splits?.slice(0, 16) ?? [];
  const minPaceSec = Math.min(...splits.map(s => paceToSec(s.pace ?? '')).filter(n => n > 0), 999999);
  const maxPaceSec = Math.max(...splits.map(s => paceToSec(s.pace ?? '')).filter(n => n > 0), 0);
  const span = Math.max(1, maxPaceSec - minPaceSec);
  const gainFt = data?.elev_gain_ft != null ? Math.round(data.elev_gain_ft) : (fallback?.gain ?? 0);
  // 2026-05-30: real elevation profile from this run's actual splits.
  // Was a hardcoded zigzag — identical on every past run. Now we
  // integrate elev_change_ft cumulatively to draw the real shape. If the
  // run is essentially flat (<3ft swing) or has no elev data we hide the
  // chart entirely rather than show a fake.
  const elev = (() => {
    if (!splits.length) return null;
    return elevPathFromSplits(splits, 360, 58, 4);
  })();
  return (
    <div className="wcard">
      <div className="wcl">RESULT <span style={{ color: '#3EBD41', marginLeft: 6 }}>✓ COMPLETED</span></div>
      {!data && loading && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>Loading run…</div>}
      {elev && (
        <div className="bk-elev" style={{ marginTop: 10 }}>
          <svg viewBox="0 0 360 58" preserveAspectRatio="none">
            <defs>
              <linearGradient id={`bke-${d.activityId ?? d.dw}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={EFF[d.type].dot} stopOpacity=".4" />
                <stop offset="1" stopColor={EFF[d.type].dot} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={elev.area} fill={`url(#bke-${d.activityId ?? d.dw})`} />
            <path d={elev.line} fill="none" stroke={EFF[d.type].dot} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      )}
      <div className="bk-elevstat">
        <span>{d.dist} MI</span>
        {gainFt > 0 && <span>↗ {gainFt} FT</span>}
        {data?.time_moving && <span>{data.time_moving}</span>}
      </div>
      {splits.length > 0 ? (
        <>
          <div className="splits" style={{ marginTop: 4 }}>
            {splits.map((s, i) => {
              const sec = paceToSec(s.pace ?? '');
              const fill = sec > 0 ? Math.round(40 + (1 - (sec - minPaceSec) / span) * 55) : 30;
              return (
                <div className="spr" key={i}>
                  <span className="spm">{s.mile}</span>
                  <div className="sptrk"><div className="spf" style={{ width: `${fill}%`, background: EFF[d.type].dot }} /></div>
                  <span className="spp">{s.pace ?? '·'}<small>/mi</small></span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, opacity: 0.6, marginTop: 14 }}>
          {d.activityId ? 'Splits unavailable for this run.' : 'No matched run yet for this day.'}
        </div>
      )}
    </div>
  );
}
function paceToSec(p: string): number {
  if (!p) return 0;
  const parts = p.split(':').map(x => parseInt(x, 10) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

/** Title-case a workout label. Backend ships some names all-caps
 *  ("THRESHOLD", "TEMPO RUN", "LONG"); design wants "Threshold",
 *  "Tempo Run", "Long". Preserves intentional acronyms · words 1-2
 *  chars stay as authored ("VO2", "PR" survive). */
/**
 * SessionBlueprint · the redesigned SESSION card per
 * designs/from Design agent/session-card/ (v2 · 2026-06-02 refined).
 *
 * SVG Z1-Z5 lane chart with each segment as a rounded block at its
 * effort zone height. Reps render as a comb of work bars + float
 * recovery bars with a bracket label above. Fuel pins drop from the
 * top. Bottom mile ruler.
 *
 * Header is a clean stat row: DISTANCE · EST TIME · EFFORT. Big
 * Oswald numbers with bright uppercase labels BELOW · separated by
 * spacing alone (no box, no divider lines, no dots). No run name in
 * the card · it lives in the page's left column (existing hero).
 *
 * Card is a flex column: header (fixed) · chart (grows to absorb
 * extra height when the card is forced tall) · coach line frosted
 * panel pinned to the bottom (no divider · the panel itself
 * separates it).
 */
function SessionBlueprint({
  distLabel, estLabel, data, coachLine,
}: {
  distLabel: string;
  estLabel: string;
  data: BlueprintData | null;
  coachLine: string | null | undefined;
}) {
  return (
    <div className="sessblue">
      <div className="sb-head">
        <div className="sb-stat">
          <div className="n">{distLabel}</div>
          <div className="k">DISTANCE</div>
        </div>
        <div className="sb-stat">
          <div className="n">{estLabel}</div>
          <div className="k">EST TIME</div>
        </div>
        <div className="sb-stat">
          <div className="n">{data?.effortLabel ?? '·'}</div>
          <div className="k">EFFORT</div>
        </div>
      </div>

      <div className="sb-chartwrap">
        {data && data.segs.length > 0 ? (
          <SessionBlueprintList data={data} />
        ) : (
          <div className="sb-empty">No structured spec for this run yet.</div>
        )}
      </div>

      {coachLine ? (
        <div className="sb-coach">
          <span className="sb-coach-dot" aria-hidden="true" />
          <span className="sb-coach-tx">{coachLine}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The SESSION breakdown · a clean, web-refined segment list (replaces
 * the prior Z1-Z5 SVG lane chart). Built from the iPhone session list,
 * dressed up for the command center: each row is a glowing zone rail +
 * the segment name + a two-column stat (pace · distance). Distances are
 * Oswald numerals right-aligned into one column so every row lines up;
 * pace tucks into its own column to the left. Hard segments (zone ≥ 3)
 * carry a faint zone-color wash so the work stands out. Interval /
 * threshold work renders inside a "REPEAT N×" group.
 *
 * Context that lives elsewhere on the page stays elsewhere — fuel is in
 * the conditions panel, the HR cap / time window are chips on the hero,
 * the effort target is the EFFORT stat above. The list is purely the
 * shape of the run.
 */
function SessionBlueprintList({ data }: { data: BlueprintData }) {
  return (
    <div className="sbl">
      <div className="sbl-eyebrow">SESSION</div>
      {data.segs.map((seg, i) =>
        seg.reps && seg.reps > 0 ? (
          <SblRepGroup key={i} seg={seg} />
        ) : (
          <SblRow
            key={i}
            color={seg.color}
            name={seg.label}
            dist={miMeasure(seg.to - seg.from)}
            pace={seg.pace ? `${seg.pace}/mi` : null}
            work={seg.zone >= 3}
          />
        ),
      )}
    </div>
  );
}

/** One segment row · glow rail · name · right-aligned pace + distance
 *  columns. `work` adds the zone-color wash for hard efforts. The rail
 *  glow / wash colors ride in via CSS custom properties so the styling
 *  lives in the stylesheet, not inline. */
function SblRow({
  color, name, dist, pace, work,
}: {
  color: string;
  name: string;
  dist: React.ReactNode;
  pace?: string | null;
  work?: boolean;
}) {
  const style = {
    '--rail': color,
    '--glow': `${color}66`,
    ...(work ? { '--wash': `${color}1f` } : {}),
  } as React.CSSProperties;
  return (
    <div className={work ? 'sbl-row work' : 'sbl-row'} style={style}>
      <span className="sbl-rail" aria-hidden="true" />
      <span className="sbl-name">{name}</span>
      <span className="sbl-stat">
        {pace ? <span className="sbl-pace">{pace}</span> : null}
        <span className="sbl-dist">{dist}</span>
      </span>
    </div>
  );
}

/** Interval / threshold work · a REPEAT N× group around one rep row and
 *  (when there's a float recovery) a recovery row. The header carries
 *  the rep count · the rows show one representative rep + recovery. */
function SblRepGroup({ seg }: { seg: BlueprintSegment }) {
  const restLabel = formatRest(seg.restSec);
  return (
    <div className="sbl-rep">
      <div className="sbl-rep-head">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 1l4 4-4 4" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <path d="M7 23l-4-4 4-4" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
        REPEAT {seg.reps}×
      </div>
      <SblRow
        color={seg.color}
        name="Rep"
        dist={seg.repDistanceLabel ? labelMeasure(seg.repDistanceLabel) : null}
        pace={seg.pace ? `${seg.pace}/mi` : null}
        work
      />
      {restLabel ? (
        <SblRow color={SBL_RECOVERY} name="Recovery" dist={labelMeasure(restLabel)} />
      ) : null}
    </div>
  );
}

/** Recovery rail · the locked-palette recovery cyan, same float color
 *  the prior chart used. */
const SBL_RECOVERY = '#27B4E0';

/** A measure rendered as a bright Oswald number + a small Inter unit, so
 *  the distance column reads as a confident stat. */
function miMeasure(mi: number): React.ReactNode {
  if (!Number.isFinite(mi) || mi <= 0) return null;
  const n = mi === Math.round(mi) ? String(Math.round(mi)) : mi.toFixed(1);
  return <>{n}<small> mi</small></>;
}

/** Split a "<number> <unit>" label ("1 mi", "800 m", "3 min") into the
 *  same Oswald-number + small-unit treatment. Falls back to the raw
 *  label if it doesn't parse. */
function labelMeasure(label: string): React.ReactNode {
  const m = label.match(/^([\d.]+)\s*(.*)$/);
  if (!m) return label;
  return <>{m[1]}<small> {m[2]}</small></>;
}

/** Recovery duration · "45s" under a minute · "3 min" on the minute ·
 *  "1:30" otherwise. Null when there's no rest to show. */
function formatRest(s?: number): string | null {
  if (!s || s <= 0) return null;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return sec === 0 ? `${m} min` : `${m}:${String(sec).padStart(2, '0')}`;
}

function toTitleCase(s: string): string {
  if (!s) return s;
  return s.split(/(\s+)/).map(w => {
    if (!w.trim()) return w;
    if (w.length <= 2) return w; // preserve VO2 / PR / 5K etc.
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join('');
}

/** Standing recommendation advisory · cooler-tone forward counsel
 *  shown when the engine still thinks the original prescription should
 *  ease (e.g. sleep streak still active after a restore). Read pattern:
 *  the runner overrode the auto-adapter, the engine respectfully holds
 *  its view. Two CTAs:
 *
 *    Accept · POSTs to /api/plan/workout/[id]/accept-standing with the
 *             suggestion payload. Applies the prescription + writes
 *             coach_intents.plan_adapt_accepted so the composer clears
 *             this advisory on next render.
 *    Proceed · no-op dismiss for this session. The engine still holds
 *              its view, so the advisory re-mounts on next page load
 *              if signals haven't cleared. That's correct doctrine:
 *              the runner is the human in the loop · the coach respects
 *              their override but doesn't pretend to agree.
 */
function StandingRecAdvisory({
  rec, workoutId, hidden, onAccepted,
}: {
  rec: FaffSeed['week'][number]['standingRecommendation'];
  workoutId: string | null;
  hidden: boolean;
  onAccepted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (!rec || hidden || dismissed) return null;

  const sug = rec.suggestion;
  const sugParts: string[] = [];
  if (sug?.proposedType) sugParts.push(toTitleCase(sug.proposedType));
  if (sug?.proposedDistanceMi != null) sugParts.push(`${sug.proposedDistanceMi} mi`);
  if (sug?.proposedDateIso) {
    try {
      const dt = new Date(sug.proposedDateIso + 'T12:00:00');
      sugParts.push(dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
    } catch { /* ignore */ }
  }
  const sugLine = sugParts.length ? `Coach suggests · ${sugParts.join(' · ')}` : null;
  const acceptLabel = sug?.proposedType
    ? `Accept · ${toTitleCase(sug.proposedType)}${sug?.proposedDistanceMi != null ? ` ${sug.proposedDistanceMi} mi` : ''}`
    : 'Accept';

  // Accept the suggestion · POST to the dedicated endpoint, refresh
  // the page so the new plan_workouts row + cleared standing rec land.
  async function onAccept() {
    if (!workoutId || !sug || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/plan/workout/${workoutId}/accept-standing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          suggestion: {
            proposedType: sug.proposedType,
            proposedDistanceMi: sug.proposedDistanceMi,
            proposedDateIso: sug.proposedDateIso,
          },
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error ?? `HTTP ${r.status}`);
      }
      onAccepted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className={`standrec sev-${rec.severity}`} role="note">
      <div className="standrec-row">
        <span className="standrec-icn" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8v4M12 16h.01"/>
            <circle cx="12" cy="12" r="9"/>
          </svg>
        </span>
        <div className="standrec-body">
          <div className="standrec-eyebrow">
            {rec.severity === 'firm' ? 'STANDING ADVICE' : 'COACH NOTE'}
          </div>
          <div className="standrec-copy">{rec.copy}</div>
          {sugLine ? <div className="standrec-sug">{sugLine}</div> : null}
          {err ? (
            <div className="standrec-err">{friendlyAcceptError(err)}</div>
          ) : null}
        </div>
        {/* 2026-06-02 · actions move to the right column so they sit
            alongside the body content instead of adding a third row
            of vertical height. Stacks back to a third row only on
            narrow viewports where the card collapses. */}
        <div className="standrec-actions">
          {sug && workoutId ? (
            <button
              type="button"
              className="standrec-btn primary"
              onClick={onAccept}
              disabled={busy}
            >
              {busy ? 'Applying…' : acceptLabel}
            </button>
          ) : null}
          <button
            type="button"
            className="standrec-btn"
            onClick={() => setDismissed(true)}
            disabled={busy}
          >
            Proceed
          </button>
        </div>
      </div>
    </div>
  );
}

/** Map raw API errors to a one-liner the runner can act on. */
function friendlyAcceptError(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes('workout_not_found')) return 'Run not found · try refreshing.';
  if (r.includes('no_changes')) return 'No change to apply.';
  if (r.includes('invalid')) return 'Coach suggestion is malformed · please reload.';
  return 'Could not apply right now. Try again in a moment.';
}

/* ───────────────  PlannedHeroV2 (Run Detail Planned · Easy)  ───────────────
 * Upcoming-run counterpart to CompletedHeroV2. Same hero-v2 frame, with:
 *   - No "on plan" check (nothing to confirm yet)
 *   - Stats are TARGETS (distance / target pace / est time)
 *   - Time-in-zones → EFFORT TARGET gradient band with marker
 *   - No route map → SESSION panel (workout shape + segments + cue)
 *   - Conditions 2×2: FORECAST / SHOE / FUEL / BEST WINDOW
 *   - Right card: "THE PLAN · UPCOMING" verdict + recap + TARGETS list
 * Source: project Run Detail Planned (Easy).html · approved 2026-05-31.
 */
function planVerdict(t: string): string {
  switch (t) {
    case 'easy':      return 'Keep it easy.';
    case 'long':      return 'Build the base.';
    case 'tempo':     return 'Sit on threshold.';
    case 'intervals': return 'Empty the engine.';
    case 'recovery':  return 'Shake the legs.';
    default:          return 'Get it done.';
  }
}
function planRecap(t: string): string {
  switch (t) {
    case 'easy':      return 'Base-building, not a workout. Keep it boring and bank the aerobic volume. If the legs feel flat, slow down. The point is time on feet, not pace.';
    case 'long':      return 'Long aerobic stimulus. Fuel early and often. Run the first half by feel and let it settle in; pick up the final third if everything is clicking.';
    case 'tempo':     return 'Threshold work compounds. Lock into the band and stay there. Pace creeping = HR creeping; back off before you bury the next session.';
    case 'intervals': return 'Quality day. Drive turnover on the reps, jog the recoveries truly easy. The point is the engine, not your splits.';
    case 'recovery':  return 'Active recovery only. Easier than easy. Skip if the legs ask for it.';
    default:          return 'Run the prescription. Don\'t freelance.';
  }
}

/**
 * 2026-06-03 · derive the FUEL chip text from the real workout_spec
 * instead of the KIT constant template ("PF 30 @ 5·10·15" was
 * hardcoded for marathon-length plans · for a 12mi long the chart
 * showed gels at 5 + 9 while the chip text still said 5·10·15).
 *
 * Source of truth: workout_spec.fuel_mi (computed by
 * lib/plan/spec-builder.ts § fuelMi). Falls back to the KIT label
 * when the spec doesn't carry fuel_mi (e.g. legacy plan rows).
 *
 * Today: defaults to "PF 30" brand (Precision Fuel 30g carb). Gel
 * brand preference will be runner-configurable in a follow-up (see
 * docs/IPHONE_SYNC_LEDGER.md gel-preference row).
 */
function deriveFuelLabel(
  d: { type: string; workoutSpec?: unknown },
  kitFallback: string,
): string {
  const spec = d.workoutSpec as { fuel_mi?: number[] } | null | undefined;
  const fuelMi = spec?.fuel_mi ?? null;
  if (Array.isArray(fuelMi)) {
    // Spec is authoritative when present: [] = run too short to fuel →
    // Water, never the KIT template (2026-06-10 · a new runner's seeded
    // 4mi tempo was rendering "PF 30 @ mi 5" — a gel at a mile the run
    // doesn't have).
    return fuelMi.length > 0 ? `PF 30 @ ${fuelMi.join('·')}` : 'Water';
  }
  if (kitFallback?.trim() && kitFallback !== ' · ') return kitFallback;
  return 'Water';
}

/**
 * 2026-06-03 · derive the COACH line for the SessionBlueprint from
 * real workout_spec values instead of KIT template strings.
 *
 * Bugs this fixes:
 *   · Thu 6/4 tempo showed "Hold 6:38" hardcoded · actual target was
 *     6:59. Now derived from workout_spec.tempo_pace_s_per_mi.
 *   · Sun 6/7 long showed "Easy first 10, then squeeze the last 4 to
 *     marathon pace" · 10+4=14 ≠ 12mi distance. Now derived from
 *     real distance with sensible defaults per workout type.
 *
 * Falls back to KIT for types whose spec doesn't carry the right
 * fields, or when distance is too small to author a useful line.
 */
function deriveCoachLine(
  d: { type: string; dist: string; pace: string | null; workoutSpec?: unknown },
  kitFallback: string,
): string {
  const spec = d.workoutSpec as {
    tempo_pace_s_per_mi?: number;
    rep_pace_s_per_mi?: number;
    fuel_mi?: number[];
    kind?: string;
  } | null | undefined;
  const fmtPace = (s?: number): string | null => {
    if (!s || s <= 0) return null;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };
  const totalMi = parseFloat(d.dist || '0') || 0;

  if (d.type === 'tempo') {
    const paceStr = fmtPace(spec?.tempo_pace_s_per_mi)
      ?? (d.pace && d.pace.match(/^\d+:\d{2}/) ? d.pace : null);
    if (paceStr) {
      return `Hold ${paceStr}. Sustainable but focused. The back half is the test.`;
    }
  }

  if (d.type === 'long' && totalMi >= 8) {
    // 2026-06-03 · gel hint now sources from workout_spec.fuel_mi ·
    // SAME field the chart's gel markers + the FUEL chip read from.
    // David flagged: prior copy said "sip water, take a gel mid-run
    // if needed" while the chart showed 2 gels at miles 5+9 for his
    // 12mi long. Now: copy names the exact gel count + positions so
    // the chip / chart / sentence all tell the same story.
    const fuelMi = Array.isArray(spec?.fuel_mi) ? spec!.fuel_mi : [];
    const gelHint = (() => {
      if (fuelMi.length === 0) return 'Sip water throughout.';
      if (fuelMi.length === 1) return `One gel around mile ${fuelMi[0]} · sip water throughout.`;
      if (fuelMi.length === 2) return `Two gels around miles ${fuelMi[0]} and ${fuelMi[1]} · sip water throughout.`;
      // 3+ gels · listing them all gets noisy · switch to the cadence framing.
      return `Take a gel every 30-45 min (miles ${fuelMi.join(', ')}) · sip water throughout.`;
    })();
    return `Easy and steady the whole way. ${gelHint}`;
  }

  if (d.type === 'intervals') {
    const paceStr = fmtPace(spec?.rep_pace_s_per_mi);
    if (paceStr) {
      return `Reps at ${paceStr}. Full float between · don't bleed the recoveries.`;
    }
  }

  return kitFallback;
}
function planEffortLabel(t: string): { copy: string; ratio: string } {
  switch (t) {
    case 'easy':      return { copy: 'Conversational · Z2',     ratio: '3 / 10' };
    case 'long':      return { copy: 'Aerobic · Z2-Z3',        ratio: '5 / 10' };
    case 'tempo':     return { copy: 'Comfortably hard · Z4',  ratio: '7 / 10' };
    case 'intervals': return { copy: 'Hard · Z5 spikes',       ratio: '9 / 10' };
    case 'recovery':  return { copy: 'Very easy · Z1',         ratio: '2 / 10' };
    default:          return { copy: 'By feel',                ratio: '— / 10' };
  }
}
/**
 * 2026-06-01 · Cadence target now comes from the seed
 * (PlannedDay.cadenceTarget) populated by backend. This wrapper
 * reads the seed-provided range when available, falls back to the
 * canonical static range when the field isn't populated (older
 * seeds, FALLBACK_WEEK rendering, etc).
 *
 * Replaces the old "relaxed" / "drive turnover" vague strings with
 * real number ranges like "172-180 spm · drive turnover" for every
 * workout type.
 */
function planCadenceTarget(
  t: string,
  baseline: number | null | undefined,
  seedTarget?: { low: number; high: number; copy: string } | undefined,
): string {
  // 2026-06-01 · David call: just the range, no descriptor cue.
  // Backend still ships `copy` with the cue · we ignore it on this
  // chip and render the numbers directly.
  if (seedTarget && seedTarget.low > 0 && seedTarget.high > 0) {
    return `${seedTarget.low}-${seedTarget.high} spm`;
  }
  // Fallback canonical range when seed is empty (mirrors backend)
  const CANONICAL: Record<string, { lo: number; hi: number }> = {
    easy:      { lo: 165, hi: 175 },
    long:      { lo: 168, hi: 178 },
    tempo:     { lo: 172, hi: 182 },
    intervals: { lo: 180, hi: 190 },
    recovery:  { lo: 162, hi: 172 },
  };
  const c = CANONICAL[t] ?? CANONICAL.easy;
  let lo = c.lo, hi = c.hi;
  if (baseline && baseline > 130 && baseline < 220) {
    const shift = Math.round(baseline - 170);
    lo = Math.max(150, Math.min(200, lo + shift));
    hi = Math.max(155, Math.min(205, hi + shift));
  }
  return `${lo}-${hi} spm`;
}
function hrTargetLabel(d: FaffSeed['week'][number]): { value: string; sub: string } {
  if (d.hrCap != null) {
    if (d.type === 'tempo' || d.type === 'intervals') return { value: `~${d.hrCap}`, sub: ` bpm · Z4` };
    // 2026-06-03 · long runs ALSO cap at Z2 per Rule 16 doctrine
    // (hrCapEasy = hrCapLong = max(89% LTHR, 78% maxHR)). David flagged
    // the Sun 6/7 card showing "<144 bpm · Z3" when 144 IS the Z2 upper
    // cap. Labeling it Z3 implied long runs should run in Z3, which
    // contradicts the cap value. Both easy + long now show Z2.
    return { value: `< ${d.hrCap}`, sub: ` bpm · Z2 cap` };
  }
  return { value: 'by feel', sub: '' };
}

function PlannedHeroV2({
  d, shoes, seedShoe, persistShoe, cadenceBaseline, skipped, onToggleSkip,
}: {
  d: FaffSeed['week'][number];
  shoes: FaffSeed['shoes'];
  seedShoe: string | null;
  persistShoe: boolean;
  cadenceBaseline: number | null;
  skipped: boolean;
  onToggleSkip: (iso: string | undefined, next: boolean) => void;
}) {
  // 2026-06-02 · totalMi feeds the SessionBlueprint chart. d.dist is
  // total post the backend 08093bbf backfill (WU + core + floats + CD).
  const totalMi = parseFloat(d.dist || '0') || 0;
  const eff  = EFF[d.type];
  const kit  = KIT[d.type];
  const forecast = useDayForecast(d.iso);
  const weatherLabel = formatForecast(forecast) ?? '—';
  const effortLbl = planEffortLabel(d.type);
  const hr = hrTargetLabel(d);
  const cadenceTgt = planCadenceTarget(d.type, cadenceBaseline, d.cadenceTarget);

  // Body-level class drains the Shell mesh to grayscale when this day is
  // viewed in skipped state. Cleanup on unmount/day-change prevents the
  // wash from sticking when navigating away.
  useEffect(() => {
    document.body.classList.toggle('day-skipped', skipped);
    return () => { document.body.classList.remove('day-skipped'); };
  }, [skipped]);

  const [busy, setBusy] = useState(false);
  async function toggleSkip() {
    if (!d.iso || busy) return;
    const next = !skipped;
    onToggleSkip(d.iso, next);   // optimistic flip in parent state
    setBusy(true);
    try {
      const r = await fetch('/api/today/skip', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: d.iso }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch {
      onToggleSkip(d.iso, !next); // revert on failure
    } finally {
      setBusy(false);
    }
  }

  const eyebrowState = skipped ? 'SKIPPED' : 'PLANNED';
  const planTag = skipped ? 'SKIPPED' : 'UPCOMING';

  // Coach-derived "why this run" payload · the deterministic engine reads
  // workout type + phase + race context + research and returns verdict +
  // facts + citations. Falls back to the legacy hardcoded strings while
  // the fetch resolves (no skeleton needed · the legacy copy is honest
  // enough as the loading state).
  const { data: purpose } = useTodayPurpose(skipped ? undefined : d.iso);
  const planV = skipped ? 'Skipped this one.'
    : (purpose?.verdict ?? planVerdict(d.type));
  const planR = skipped
    ? "No problem. One easy day won't set you back, and the plan keeps your weekly volume on track. Restore it if you change your mind."
    : (purpose?.facts.join(' ') ?? planRecap(d.type));
  // 2026-05-31: citations dropped per voice doctrine · no academic
  // chrome on the runner's screen. The engine still reads research-
  // grounded rules · just doesn't put the footnotes in the UI.

  // 2026-06-01 · adaptation provenance line under the title when the
  // auto-adapter mutated this row. Surfaces WHY at the hero level so
  // the runner doesn't have to open the modal to learn the change.
  // 2026-06-01 update · suppress no-op adaptations · when originalType
  // collapses to the current type/subLabel, the banner read "Adjusted
  // from EASY" with nothing actually different. Skip rendering when
  // labels are equal.
  const adaptedRaw = d.adaptation?.wasAdapted;
  const adaptVerb: Record<string, string> = {
    downgrade: 'Downgraded',
    reschedule: 'Rescheduled',
    shave: 'Shortened',
    mark_dirty: 'Paces refreshed',
    other: 'Adjusted',
  };
  const adaptedFromLabel = adaptedRaw
    ? (d.adaptation!.originalSubLabel || d.adaptation!.originalType)
    : null;
  const currentForCompare = (d.subLabel || d.name || d.type || '').toString().toUpperCase().trim();
  const fromForCompare = (adaptedFromLabel ?? '').toString().toUpperCase().trim();
  const isNoOpAdaptation = !!adaptedRaw && !!fromForCompare && fromForCompare === currentForCompare;
  const adapted = adaptedRaw && !isNoOpAdaptation;
  const adaptVerbCopy = adapted ? (adaptVerb[d.adaptation!.kind ?? 'other'] ?? 'Adjusted') : '';

  // 2026-06-01 · Restore original. Same POST /api/plan/restore endpoint
  // the modal version uses (backend commit d8a4082d). Surfaced inline
  // on the hero adaptation banner so the runner sees it where they're
  // already looking · the modal version on Train tab still exists for
  // when the runner arrives via FULL PLAN / KEY WORKOUTS chip click.
  const router = useRouter();
  const [restoring, setRestoring] = useState(false);
  const [restoreErr, setRestoreErr] = useState<string | null>(null);
  const [restoreDone, setRestoreDone] = useState(false);
  async function handleRestore() {
    if (!d.planWorkoutId || restoring) return;
    setRestoring(true);
    setRestoreErr(null);
    try {
      const r = await fetch('/api/plan/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutId: d.planWorkoutId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !(j as { ok?: boolean }).ok) {
        const raw = (j as { error?: string }).error ?? `HTTP ${r.status}`;
        // 2026-06-01: log raw error to console so devtools can debug
        // while the UI message stays clean. Friendly mapping below
        // never leaks raw SQL. If you're David seeing "Cannot restore
        // right now" and not sure why, open browser devtools console
        // and look for [restore] entries · the raw backend response
        // is there.
        // eslint-disable-next-line no-console
        console.error('[restore] backend error', { raw, status: r.status, body: j, workoutId: d.planWorkoutId });
        const friendly = /operator does not exist|relation|column.*does not exist/i.test(raw)
            ? 'Cannot restore right now. Try again in a moment.'
          : raw === 'not_adapted'        ? 'This run has no original to restore.'
          : raw === 'missing_originals'  ? 'No original on record for this run.'
          : raw === 'cannot_restore_past' ? "Can't restore a completed run."
          : raw === 'workout_not_found'  ? "Couldn't find this run."
          : raw === 'workoutId_required' || raw === 'invalid_json' ? 'Restore request was malformed.'
          : 'Cannot restore right now. Try again in a moment.';
        setRestoreErr(friendly);
        return;
      }
      setRestoreDone(true);
      router.refresh();
    } catch (e) {
      // Network / fetch threw before getting a JSON response.
      setRestoreErr('Could not reach the server. Check your connection and try again.');
      void e;
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className={`hero-v2${skipped ? ' skipped' : ''}`}>
      {/* hmain now hosts title + leftstack only · session moved out to
          be a sibling so it can top-align with wcard. Layout becomes a
          3-column flex row (hmain | session | wcard) instead of a
          2-column with session nested inside hmain. */}
      <div className="hmain" style={meshGradient(d.type)}>
        {/* 2026-06-03 · David: drop the "DAY · TYPE · PLANNED" eyebrow ·
            it repeats the week strip + the title. Title row sits at the
            top of the column now. */}
        <div className="titlerow">
          {/* 2026-06-02 · one-word hero title via lib/coach/workout-title.
              Locked vocabulary shared with iPhone + watch. Replaces the
              sub_label render ("4×1 MI @ I · 3 Min Jog") that truncated
              awkwardly when there's a right-side panel. The rich
              sub_label moves into the SESSION grid where it has room. */}
          <h1 className="htitle">{workoutTypeTitle(d.type)}</h1>
        </div>

        {adapted && adaptedFromLabel ? (
          <div className="adaptline">
            <span className="adapt-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M4 4v6h6"/><path d="M20 20a8 8 0 0 0-13.6-5.6L4 17"/></svg>
            </span>
            <span className="adapt-body">
              <b>{adaptVerbCopy} from {adaptedFromLabel.toUpperCase()}.</b>
              {d.adaptation?.reason ? <> {d.adaptation.reason}</> : null}
              {d.planWorkoutId && !restoreDone ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="adapt-restore"
                    disabled={restoring}
                    onClick={handleRestore}
                  >
                    {restoring ? 'Restoring…' : 'Restore original →'}
                  </button>
                </>
              ) : null}
              {restoreDone ? (
                <span className="adapt-restored"> · Restored. Refreshing…</span>
              ) : null}
              {restoreErr ? (
                <span className="adapt-restore-err"> · {restoreErr}</span>
              ) : null}
            </span>
          </div>
        ) : null}

        <div className="leftstack">
          <div className="stats">
            <div><div className="v">{d.dist}<small> mi</small></div><div className="k">DISTANCE</div></div>
            <div><div className="v">{d.pace}<small>{/:/.test(d.pace) ? '/mi' : ''}</small></div><div className="k">TARGET PACE</div></div>
            <div><div className="v">{d.est.replace(/^~/, '~')}</div><div className="k">EST TIME</div></div>
          </div>

          <div className="effort-band">
            <div className="ehead">
              <span>EFFORT TARGET</span>
              <span className="em">{effortLbl.copy}</span>
            </div>
            <div className="etrack">
              <div className="emark" style={{ left: `${eff.mark}%` }}>
                <span className="elbl">{eff.lbl}</span>
                <span className="ecaret" />
              </div>
            </div>
            <div className="ezones">
              <span>Z1</span><span>Z2</span><span>Z3</span><span>Z4</span><span>Z5</span>
            </div>
          </div>

          <div className="cond">
            <div>
              <div className="kcl">FORECAST</div>
              <div className="kcv">{weatherLabel}</div>
            </div>
            <div>
              <div className="kcl">SHOE</div>
              <ShoePicker shoes={shoes} initial={seedShoe} persist={persistShoe} />
            </div>
            <div>
              <div className="kcl">FUEL</div>
              <div className="kcv">{deriveFuelLabel(d, kit.fuel)}</div>
            </div>
            <div>
              <div className="kcl">BEST WINDOW</div>
              <div className="kcv">{bestWindow(forecast)}</div>
            </div>
          </div>
        </div>
      </div>

      <SessionBlueprint
        distLabel={`${d.dist} mi`}
        estLabel={d.est.replace(/^~/, '~')}
        data={deriveBlueprintData(d.workoutSpec ?? null, totalMi, d.type, d.pace)}
        coachLine={deriveCoachLine(d, kit.coach)}
      />

      <aside className="wcard">
        <div className="wcl">
          THE PLAN
          <span className="tag">{planTag}</span>
        </div>
        <div className="verdict">{planV}</div>
        <div className="recap">{planR}</div>
        <div className="tgts-h">TARGETS</div>
        <div className="tgt">
          <span className="tk">HEART RATE</span>
          <span className="tv">{hr.value}<small>{hr.sub}</small></span>
        </div>
        <div className="tgt">
          <span className="tk">EFFORT</span>
          <span className="tv">{effortLbl.ratio}<small> · {d.type}</small></span>
        </div>
        <div className="tgt">
          <span className="tk">CADENCE</span>
          <span className="tv">{cadenceTgt}</span>
        </div>
        <button className="skipbtn" type="button" onClick={toggleSkip} disabled={busy}>
          {skipped ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 2.6-6.36"/><path d="M3 4v5h5"/></svg>
              <span>Restore run</span>
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
              <span>Skip this run</span>
            </>
          )}
        </button>
      </aside>
    </div>
  );
}

/** Pick the coolest morning window for a planned run. Prefers the
 *  server-composed `best_window` field (added 2026-06-01 for iPhone
 *  parity · single source of truth) when present, falls back to the
 *  legacy client derivation for older forecasts cached without the
 *  field. */
function bestWindow(f: { temp_min_f: number | null; temp_max_f: number | null; best_window?: string } | null): string {
  // No forecast → no window. Never invent one (2026-06-10 honesty pass).
  if (!f) return '—';
  if (f.best_window) return f.best_window;
  // Legacy fallback · matches the server's composeBestWindow for older
  // cached forecasts. Drop once 30-min cache cycles past 2026-06-01.
  if (f.temp_max_f != null && f.temp_max_f >= 80) return 'Before 7 AM';
  if (f.temp_max_f != null && f.temp_max_f >= 70) return '6–8 AM';
  return '6–9 AM';
}

/* ───────────────  CompletedHeroV2 (Post-Run Detail · Easy)  ───────────────
 * Implements the approved 2026-05-31 design (project Post-Run Detail (Easy).html).
 * Layout:  [hmain (htag + title + check + hbody[leftstack + mapcol])]  [wcard]
 *  - hmain.titlerow:  "EASY"  +  green check (no "On plan" text)
 *  - hmain.leftstack: stats / time-in-zones / conditions grid w/ shoe picker
 *  - hmain.mapcol:    real GPS polyline (or "ROUTE FROM GPS" placeholder)
 *  - wcard:           "HOW IT WENT · ON PLAN" verdict + recap + mile splits
 *
 * Effort theme tokens are inherited from the surrounding mesh (Shell already
 * sets the effort-driven mesh on completed days), so the hero picks up the
 * green/teal "easy" feel without per-component overrides.
 */
function deriveVerdict(d: FaffSeed['week'][number], runData: RunSummary | null): string {
  const planned = Number(d.dist) || 0;
  const actual  = runData?.distance_mi ?? planned;
  if (planned && actual >= planned * 0.95 && actual <= planned * 1.1) {
    if (d.type === 'easy')      return 'Textbook easy day.';
    if (d.type === 'long')      return 'Held the long-run line.';
    if (d.type === 'tempo')     return 'Tempo locked in.';
    if (d.type === 'intervals') return 'Reps hit clean.';
    if (d.type === 'recovery')  return 'Recovery on target.';
    return 'On plan.';
  }
  if (planned && actual < planned * 0.95) return 'Tucked in under target.';
  if (planned && actual > planned * 1.1)  return 'Went a touch deeper than planned.';
  return 'Run logged.';
}

function deriveRecap(d: FaffSeed['week'][number], runData: RunSummary | null): string {
  const z = runData?.hrZonePcts;
  if (z) {
    const z2 = z.z2 ?? 0;
    const z4 = (z.z4 ?? 0) + (z.z5 ?? 0);
    if (d.type === 'easy' && z2 >= 60)
      return 'Held Zone 2 the whole way and never let the pace creep. The quiet aerobic work the plan wants.';
    if ((d.type === 'tempo' || d.type === 'intervals') && z4 >= 25)
      return 'Got into the threshold band and held it. Plan called for it, you delivered.';
    if (d.type === 'long' && z2 >= 50)
      return 'Aerobic the whole way. The miles bank for race day.';
  }
  if (d.type === 'easy')      return 'Easy day in the bank. Don\'t overthink it.';
  if (d.type === 'long')      return 'Long run done. Recover and roll into the next quality day.';
  if (d.type === 'tempo')     return 'Tempo in the book. Threshold work compounds.';
  if (d.type === 'intervals') return 'Reps done. The engine got a real ask.';
  if (d.type === 'recovery')  return 'Recovery jog logged. Easy is the assignment.';
  return 'Logged.';
}

// ─── Segmented mile splits · iPhone-parity breakdown (2026-06-11) ────────
//
// Ported from native TodayPostRunBody.swift (phasedSplitList + SplitRow)
// per David: "I like how the iphone app does the breakdown better." Groups
// the per-mile splits by phase (warm-up / work / cool-down) via the
// phase_breakdown cumulative distances. Per-mile bar: work miles get a
// target-zone range bar (zone = target ± tolerance, dot = actual pace ·
// slower left, faster right); warm-up / cool-down get a simple proportional
// bar (longer = slower). Dark-surface variant — the wcard is dark.
// Effort → gradient + dot color. These mirror the effort-mesh tokens in the design brief.
// Recovery/warmup/cooldown: RECOVERY mesh (teal). Tempo: orange → race-pink. Intervals: race-pink → red.
const EFFORT_GRADIENT: Record<string, string> = {
  tempo:     'linear-gradient(90deg,#F3AD38,#FC4D64)',
  intervals: 'linear-gradient(90deg,#FC4D64,#D03F3F)',
  recovery:  'linear-gradient(90deg,#27B4E0,#48B3B5)',
  easy:      'linear-gradient(90deg,#27B4E0,#48B3B5)',
  long:      'linear-gradient(90deg,#27B4E0,#48B3B5)',
};
const EFFORT_DOT: Record<string, string> = {
  tempo:     '#FF8847',
  intervals: '#FC4D64',
};
const RECOVERY_GRAD = 'linear-gradient(90deg,#27B4E0,#48B3B5)';
const RECOVERY_DOT  = '#27B4E0';

function PhasedSplitRow({
  mile, pace, hr, gradient, dotColor, paceSec, fastest, denom, targetSec, tolSec,
}: {
  mile: number; pace: string | null; hr: number | null;
  gradient: string; dotColor: string;
  paceSec: number; fastest: number; denom: number;
  targetSec: number | null; tolSec: number | null;
}) {
  const track = 'rgba(255,255,255,.1)';
  const isRange = targetSec != null && tolSec != null && tolSec > 0 && paceSec > 0;
  const span = (tolSec ?? 0) * 4;
  const trackLeft = (targetSec ?? 0) + (tolSec ?? 0) * 2;
  const dotFrac = span > 0 ? Math.max(0, Math.min(1, (trackLeft - paceSec) / span)) : 0.5;
  const simpleW = Math.max(14, 25 + 75 * (denom > 0 ? (paceSec - fastest) / denom : 0));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 18, flex: '0 0 auto', fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.78)' }}>{mile}</span>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ position: 'relative', height: 8, borderRadius: 4, background: track }}>
          {isRange ? (
            <>
              {/* tolerance zone — gradient fill at low opacity */}
              <div style={{ position: 'absolute', left: '25%', width: '50%', top: 0, bottom: 0, borderRadius: 2, background: gradient, opacity: 0.28 }} />
              {/* target center line */}
              <div style={{ position: 'absolute', left: 'calc(50% - 0.75px)', width: 1.5, top: 0, bottom: 0, background: dotColor + '90' }} />
              {/* actual-pace dot */}
              <div style={{ position: 'absolute', left: `calc(${(dotFrac * 100).toFixed(2)}% - 4.5px)`, top: -0.5, width: 9, height: 9, borderRadius: '50%', background: dotColor, boxShadow: `0 0 5px ${dotColor}80` }} />
            </>
          ) : (
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${simpleW.toFixed(1)}%`, borderRadius: 4, background: gradient }} />
          )}
        </div>
      </div>
      <span style={{ width: 48, flex: '0 0 auto', textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>{pace ?? '—'}</span>
      <span style={{ width: 30, flex: '0 0 auto', textAlign: 'right', fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.5)' }}>{hr ?? '—'}</span>
    </div>
  );
}

function PhasedMileSplits({
  phases, splits, accent, effort,
}: {
  phases: NonNullable<RunSummary['phase_breakdown']>;
  splits: RunSummary['splits'];
  accent: string;
  effort: string;
}) {
  const paceSecs = splits.map(s => paceToSec(s.pace ?? '')).filter(n => n > 0);
  const fastest = paceSecs.length ? Math.min(...paceSecs) : 0;
  const slowest = paceSecs.length ? Math.max(...paceSecs) : 1;
  const denom = Math.max(1, slowest - fastest);

  // Assign each split to a phase via cumulative phase distances (iPhone parity).
  const cum: number[] = [];
  let running = 0;
  for (const p of phases) { running += (p.actual_distance_mi ?? p.target_distance_mi ?? 0); cum.push(running); }
  const phaseIdxForMile = (mile: number) => {
    const mid = mile - 0.5;
    const i = cum.findIndex(c => mid < c);
    return i === -1 ? cum.length - 1 : i;
  };
  const phaseLabel = (p: NonNullable<RunSummary['phase_breakdown']>[number]) => {
    switch (p.type) {
      case 'warmup': return 'WARM-UP';
      case 'cooldown': return 'COOL-DOWN';
      case 'recovery': return 'RECOVERY';
      case 'work': return effort === 'intervals' ? 'INTERVALS' : effort === 'tempo' ? 'TEMPO' : 'WORK';
      default: return (p.label || '').toUpperCase();
    }
  };
  const sub = { fontSize: 11, fontWeight: 600 as const, color: 'rgba(255,255,255,.5)' };

  return (
    <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'rgba(255,255,255,.55)' }}>MILE SPLITS</div>
      {phases.map((phase, idx) => {
        const group = splits.filter(s => phaseIdxForMile(s.mile) === idx);
        if (!group.length) return null;
        const phaseGradient = phase.type === 'work'
          ? (EFFORT_GRADIENT[effort] ?? RECOVERY_GRAD)
          : RECOVERY_GRAD;
        const dotColor = phase.type === 'work'
          ? (EFFORT_DOT[effort] ?? accent)
          : RECOVERY_DOT;
        const targetSec = phase.type === 'work'
          ? (phase.target_pace_sec ?? (phase.target_pace ? paceToSec(phase.target_pace) : null))
          : null;
        const tolSec = phase.type === 'work' ? (phase.tolerance_pace_sec ?? 8) : null;
        return (
          <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, background: phaseGradient, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>{phaseLabel(phase)}</span>
              {phase.actual_distance_mi != null && <span style={sub}>{phase.actual_distance_mi.toFixed(1)} mi</span>}
              <span style={{ flex: 1 }} />
              {phase.avg_hr != null && <span style={sub}>{phase.avg_hr} bpm</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {group.map(s => (
                <PhasedSplitRow
                  key={s.mile}
                  mile={s.mile} pace={s.pace} hr={s.hr ?? null}
                  gradient={phaseGradient} dotColor={dotColor}
                  paceSec={paceToSec(s.pace ?? '')} fastest={fastest} denom={denom}
                  targetSec={targetSec} tolSec={tolSec}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CompletedHeroV2({
  d, result, runData, runLoading,
  resolvedTime, resolvedPace, resolvedHr, resolvedTempF, resolvedTempRange,
  resolvedGainFt, resolvedShoeNm,
  shoes, seedShoe, persistShoe,
}: {
  d: FaffSeed['week'][number];
  result?: FaffSeed['results'][number];
  runData: RunSummary | null;
  runLoading: boolean;
  resolvedTime: string | undefined;
  resolvedPace: string | undefined;
  resolvedHr: number | undefined;
  resolvedTempF: number | null;
  resolvedTempRange: RunSummary['temp_range_f'];
  resolvedGainFt: number | undefined;
  resolvedShoeNm: string | undefined;
  shoes: FaffSeed['shoes'];
  seedShoe: string | null;
  persistShoe: boolean;
}) {
  // Decode the run's GPS polyline once per runData change.
  // 2026-05-31: viewBox bumped to 700x440 (closer to the card's natural
  // aspect on desktop) and the route now carries projected mile markers +
  // 2026-05-31 ship · the SVG-only route render (with synthetic terrain
  // grid + mile markers + endpoint dots) was replaced with the Style F+
  // stack: CartoDB Dark Matter tiles via Leaflet + pace-graded polyline
  // overlay. Component is at <RouteMap polyline=... splits=... />. See
  // designs/route-map-mockups + /dev/route-map-mockups for the review
  // surface that approved it.
  const hasRoute = Boolean(runData?.route_polyline);
  // Per-mile elevation strip · still drawn as a small absolute-positioned
  // SVG overlay along the bottom of the map card when the run has
  // meaningful elevation change. The helper returns null for <3ft range
  // so flat runs stay honest.
  const elevStrip = (runData?.splits && runData.splits.length >= 2)
    ? elevPathFromSplits(runData.splits, 700, 64, 4)
    : null;

  // Coach-derived post-run payload. When the engine has spoken we use its
  // verdict + facts (which read on-plan vs heat-impacted vs fade with the
  // right framing) and surface conditions_note + coach_tip in their own
  // callouts. Falls back to the local heuristics while the fetch resolves.
  const { data: recapPayload } = useRunRecap(d.activityId);
  const verdict = recapPayload?.verdict ?? deriveVerdict(d, runData);
  const recap = recapPayload?.facts?.length
    ? recapPayload.facts.join(' ')
    : ((result?.recap?.trim()) || deriveRecap(d, runData));

  // Zones from runData (preferred) → seed.results placeholder fallback.
  const zonePcts = runData?.hrZonePcts
    ? [runData.hrZonePcts.z1 ?? 0, runData.hrZonePcts.z2 ?? 0, runData.hrZonePcts.z3 ?? 0, runData.hrZonePcts.z4 ?? 0, runData.hrZonePcts.z5 ?? 0]
    : (result?.zones ?? [0, 0, 0, 0, 0]);
  // 2026-06-04 · David: "The colors in the HR zone bar are really
  // weak/faded/pastel not on brand."  Swapped from the -a (faded
  // 'stacked time-in-zones' set) to the canonical -b brand zone
  // Zone colors. Chosen for legibility on BOTH dark cards (planned/rest)
  // AND bright-background cards (easy=teal, tempo=orange mesh).
  // Z1 upgraded from the retired #48B3B5 (same teal as easy-run card = invisible)
  // to a lighter, higher-contrast blue-white that reads against the
  // dark bar trough (rgba(0,0,0,.28) background) and the bright card.
  // AFC fix 2 (2026-06-09) · synced to the ONE canonical zone ladder
  // (= effort temperature scale · constants.ts ZC · Theme.swift ZoneSplit
  // · RunDetailModal ZONE_COLOR): z1 recovery blue · z2 easy teal ·
  // z3 long amber · z4 tempo ember · z5 intervals rose. The previous
  // local set used the good-state green as Z2 and a one-off #7DD8E0 as
  // Z1 · if #27B4E0 proves too dim against the dark bar trough, raise it
  // in the palette, not per-site.
  const zoneColors = ['#27B4E0', '#14C08C', '#F3AD38', '#D03F3F', '#FC4D64'];
  const peakHr = runData?.hr_max ?? result?.peak ?? null;

  // Render every split the run carries (was capped at 8 · landed
  // 2026-05-31 after David flagged a 12.1mi long run rendering only
  // splits 1-8). The CSS in .splits handles long lists with its own
  // scroll/overflow.
  //
  // 2026-06-04 · synthesized-estimated fallback REVERTED.  David
  // ("we have this data · why are we estimating · wtf is happening")
  // was right · the data exists from the iPhone HK ingest.  Root cause
  // was the watch endpoint clobbering it: deriveSplitsFromPhases wrote
  // a phase-derived stub to data.splits, the canonical-merge picked
  // the watch row as canonical (tier 5 > apple_health tier 2), and the
  // HK row's real splits never made it through.
  //
  // Fixed at the source · /api/watch/workouts/complete no longer
  // writes data.splits at all.  Phases live in coach_intents.value
  // (loadPhaseBreakdown reads them); data.splits is reserved for
  // genuine per-mile data from HK ingest or Strava sync.  The
  // canonical-merge absorber populates the canonical row's splits
  // from whichever loser actually has them.
  const splits = runData?.splits ?? [];

  // Elevation sanity check. Strava + barometric watches occasionally
  // report multi-thousand-foot gain on flat suburban runs when the
  // sensor drifts during a humidity / pressure swing. Flag values that
  // exceed 200 ft/mi (mountain-running territory) as approximate so
  // the runner knows the number is suspicious rather than treating it
  // as a personal best vert day.
  const distMi = runData?.distance_mi ?? (Number(d.dist) || 0);
  const elevPerMi = (resolvedGainFt != null && distMi > 0) ? resolvedGainFt / distMi : 0;
  const elevSuspicious = elevPerMi > 200;

  // Verdict badge · "did the runner do what they were supposed to do?"
  // The doctrine varies by workout type:
  //
  //   · EASY / RECOVERY · the assignment is "keep it easy for ~N miles."
  //     Distance is negotiable (going short on a hot day is correct
  //     execution); what matters is whether the runner stayed in Z1-Z2.
  //     ON PLAN when Z1+Z2 share ≥ 85% AND actual ≥ 75% of planned
  //     (caps the case where 1 mi instead of 6 mi clearly wasn't the
  //     workout). When zone data is missing we degrade to the legacy
  //     ±10% distance check.
  //
  //   · EVERYTHING ELSE · the prescribed dose matters. Distance within
  //     ±15% (slightly more forgiving than the old ±10%, which flagged
  //     normal Garmin/HK rounding as off-plan).
  //
  // HOT DAY swaps in when heat bump ≥ 5 bpm · the coach acknowledges
  // the conditions instead of a hollow ON PLAN.
  //
  // 2026-06-02 · David flagged a 5.1 mi easy run (vs 6 mi planned, 85%)
  // with KEPT IT EASY 100% + +3 bpm drift firing OFF PLAN. Badge was
  // punishing the right call · runner DID what the easy doctrine wants.
  const plannedMi = Number(d.dist) || 0;
  const actualMi  = runData?.distance_mi ?? plannedMi;
  const heatBump = runData?.weather_context?.hr_bump_bpm ?? 0;
  const isEasy = d.type === 'easy' || d.type === 'recovery';
  const easyShare = runData?.hrZonePcts
    ? Math.round((runData.hrZonePcts.z1 ?? 0) + (runData.hrZonePcts.z2 ?? 0))
    : null;

  // 2026-06-03 · Rule 17 · Easy verdict is PACE-first.
  //
  // Easy days are defined by PACE for runners with calibrated paces.
  // HR is the DESCRIPTIVE signal (cardiovascular state · heat, sleep,
  // fatigue, life), not the GATING signal. If the runner hit the
  // prescribed pace band AND the prescribed distance, they executed
  // easy correctly · period. HR drifting into Z3 doesn't mean they
  // pushed; it means they were running easy in a hot/tired body.
  //
  // Was: easyShare ≥ 85% (Z1+Z2 share) gated the verdict. Failed for
  //   any runner whose HR ran above their (now Rule-16-fixed) Z2
  //   ceiling · heat, sleep debt, fitness state, all trip OFF PLAN
  //   even when the runner DID exactly what easy demanded.
  // Now: pace-first. Pace inside the plan's pace_target band = easy
  //   was executed correctly. HR informs the recap copy but doesn't
  //   gate the verdict.
  //
  // Doctrine: Daniels Running Formula 3e · "E pace is defined by pace,
  // not heart rate. HR is the feedback signal."
  //
  // For non-easy (quality / long / race) the pace+distance gate stays
  // the same · those workouts ARE intensity-defined.
  const specPaceLo = (d.workoutSpec as Record<string, number> | null)?.pace_target_s_per_mi_lo ?? null;
  const specPaceHi = (d.workoutSpec as Record<string, number> | null)?.pace_target_s_per_mi_hi ?? null;
  // Parse runData.pace ("8:18") to seconds when pace_s_per_mi isn't on
  // the envelope. Inline since this is the only callsite in the file.
  const actualPaceSec: number | null = (() => {
    const direct = (runData as { pace_s_per_mi?: number } | undefined)?.pace_s_per_mi;
    if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
    const s = typeof runData?.pace === 'string' ? runData.pace.trim() : null;
    if (!s) return null;
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  })();
  // Pace within ±15s of the band edges is still "in band" (band is
  // already a 30s window; this stops a 1s-over from flipping verdict).
  const paceInBand = isEasy && specPaceLo != null && specPaceHi != null && actualPaceSec != null
    ? actualPaceSec >= specPaceLo - 15 && actualPaceSec <= specPaceHi + 15
    : null;

  const onPlan = (() => {
    if (plannedMi <= 0) return false;
    if (isEasy) {
      const distanceOk = actualMi >= plannedMi * 0.75 && actualMi <= plannedMi * 1.2;
      if (!distanceOk) return false;
      // Rule 17 · pace-first when pace data + spec available.
      if (paceInBand != null) return paceInBand;
      // No pace target on this row · legacy easyShare gate (rare ·
      // workouts without workout_spec).
      if (easyShare != null) return easyShare >= 85;
      // No HR + no pace data · trust distance alone for easy.
      return true;
    }
    // Quality / long / fallback · ±15% distance window.
    return actualMi >= plannedMi * 0.85 && actualMi <= plannedMi * 1.15;
  })();

  // 2026-06-03 · HOT DAY rescue · for NON-easy types where heat is
  // bumping HR significantly above what pace alone would predict.
  // Easy is already pace-first (Rule 17) · pace tells the truth, heat
  // doesn't change the verdict. This rescue only fires for quality/long
  // where HR running hot signals real cardiovascular cost.
  const distanceWithinEasyTolerance =
    plannedMi > 0 && actualMi >= plannedMi * 0.75 && actualMi <= plannedMi * 1.2;
  const heatRescue = !isEasy && heatBump >= 5 && distanceWithinEasyTolerance;

  const verdictBadge: 'on-plan' | 'hot-day' | 'off-plan' =
    onPlan && heatBump >= 5 ? 'hot-day'
    : heatRescue ? 'hot-day'
    : onPlan ? 'on-plan'
    : 'off-plan';

  return (
    // 2026-05-31: hero-v2-done modifier triggers a three-column layout
    // where .mapcol breaks out of .hmain and becomes a top-level sibling.
    // This top-aligns the route card with the htag eyebrow AND the wcard,
    // so the route starts at the same vertical line as TODAY · LONG · DONE
    // and HOW IT WENT. The default .hero-v2 (used by PlannedHeroV2) keeps
    // the two-column layout where .mapcol sits inside .hbody.
    <div className="hero-v2 hero-v2-done">
      <div className="hmain" style={meshGradient(d.type)}>
        {/* 2026-06-03 · David: drop the "DAY · TYPE · DONE" eyebrow ·
            it repeats the week strip + the title. Title row sits at the
            top of the column now, aligning with the route + recap card
            top edges. */}
        <div className="titlerow">
          <h1 className="htitle">{workoutTypeTitle(d.type)}</h1>
          <span className="check" title="On plan" aria-label="On plan">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          </span>
        </div>

        <div className="leftstack">
            <div className="stats">
              {/* 2026-06-03 · DISTANCE on DONE state shows ACTUAL run
                  mileage (rounded to 1 decimal), not planned. Sibling
                  TIME + AVG PACE already show actual values. Showing
                  planned "6.0" next to actual time of a 6.08 mi run
                  reads as inconsistent · and worse, the right-side
                  recap text uses actual ("Easy 6.1 mi") so the two
                  display the same run with different distances. */}
              <div><div className="v">{
                runData?.distance_mi != null
                  ? runData.distance_mi.toFixed(1)
                  : d.dist
              }<small> mi</small></div><div className="k">DISTANCE</div></div>
              <div><div className="v">{resolvedTime ?? '·'}</div><div className="k">TIME{runLoading && !runData ? ' …' : ''}</div></div>
              <div><div className="v">{resolvedPace ?? '·'}<small>/mi</small></div><div className="k">AVG PACE</div></div>
            </div>

            <div className="zones">
              <div className="zhead">
                <span>TIME IN ZONES</span>
                <span className="zmeta">avg ♥ <b>{resolvedHr ?? '·'}</b> · pk <b>{peakHr ?? '·'}</b></span>
              </div>
              <div className="zbar">
                {zonePcts.map((p, zi) => p > 0 && (
                  <i key={zi} style={{ width: `${p}%`, background: zoneColors[zi] }} />
                ))}
              </div>
              <div className="zleg">
                {zonePcts.map((p, zi) => (
                  <div key={zi} style={p === 0 ? { opacity: 0.5 } : undefined}>
                    <span className="zs" style={{ background: zoneColors[zi] }} />
                    Z{zi + 1} <b>{Math.round(p)}%</b>
                  </div>
                ))}
              </div>
            </div>

            <div className="cond">
              <div>
                <div className="kcl">WEATHER</div>
                {/* 2026-06-02 · matches RunDetailModal's renderTempRange:
                    when start ↔ end differs ≥3°F across the run, show the
                    arc "65°F → 77°F". Falls through to peak, then
                    single-point temp_f. We had this on the modal already;
                    the post-run hero was the gap. */}
                <div className="kcv">{formatWeatherChip(resolvedTempF, resolvedTempRange)}</div>
              </div>
              <div>
                <div className="kcl">SHOE</div>
                <ShoePicker
                  shoes={shoes}
                  initial={resolvedShoeNm?.trim() || seedShoe}
                  persist={persistShoe}
                  runId={d.activityId ?? null}
                />
              </div>
              {/* 2026-06-04 · David's QC: a bare "·" placeholder for missing
                  elev / shoe / power reads as broken. Use the same honest
                  "no data" pattern shipped on Health tiles (task #206
                  hybrid tiles). The chip stays in place so the grid
                  doesn't reflow, but the value reads as a known gap
                  instead of a render glitch. */}
              <div>
                <div className="kcl">ELEV GAIN{elevSuspicious ? ' · APPROX' : ''}</div>
                <div className="kcv" style={
                  (resolvedGainFt == null || resolvedGainFt <= 0)
                    ? { color: 'rgba(246,247,248,0.42)', fontSize: 13, fontWeight: 600, letterSpacing: 0.4 }
                    : (elevSuspicious ? { color: 'rgba(246,247,248,0.62)' } : undefined)
                }>
                  {resolvedGainFt != null && resolvedGainFt > 0 ? `${resolvedGainFt} ft` : 'NO DATA'}
                </div>
              </div>
              <div>
                <div className="kcl">{runData?.power_avg_w != null ? 'AVG POWER' : 'CALORIES'}</div>
                <div className="kcv" style={
                  (runData?.power_avg_w == null && (!result?.cal || result.cal <= 0))
                    ? { color: 'rgba(246,247,248,0.42)', fontSize: 13, fontWeight: 600, letterSpacing: 0.4 }
                    : undefined
                }>
                  {runData?.power_avg_w != null
                    ? `${runData.power_avg_w} W`
                    : (result?.cal && result.cal > 0 ? `${result.cal} kcal` : 'NO DATA')}
                </div>
              </div>
            </div>

            {/* CONDITIONS + COACH TIP + CITATIONS · moved from inside
                .wcard 2026-05-31 (David: distribution is more even
                with conditions/coach under the tiles · the wcard was
                taller than the leftstack and that was driving the
                route map height absurdly tall). Now they live in the
                left column under the elev/calories grid, the wcard
                holds just the verdict + recap + mile splits, and the
                three columns finish at roughly the same vertical
                line. */}
            {/* 2026-06-03 · was a tinted fill (12% orange / 10% teal) with
                weak border · on the tempo/intervals mesh the orange tint
                vanished and the teal box didn't read either.  Matches the
                pattern already shipped in RunDetailModal · dark scrim
                rgba(10,12,16,.62) + colored 55%-alpha border for identity
                + white body at fw 500 + accent only on the eyebrow label.
                The "four legibility laws" comment block in RunDetailModal
                explains the contract. */}
            {recapPayload?.conditions_note ? (
              <div className="hero-callout">
                <div className="hc-label" style={{ color: '#FFB07A' }}>CONDITIONS</div>
                <div className="hc-body">{recapPayload.conditions_note}</div>
              </div>
            ) : runData?.weather_context ? (
              <div className="hero-callout">
                <div className="hc-body">
                  {runData.weather_context.message}
                  {runData.weather_context.hr_bump_bpm > 0 ? (
                    <> · HR +{runData.weather_context.hr_bump_bpm} bpm expected</>
                  ) : null}
                </div>
              </div>
            ) : null}

            {recapPayload?.coach_tip ? (
              <div className="hero-callout">
                <div className="hc-label" style={{ color: '#7BE8DC' }}>COACH TIP</div>
                <div className="hc-body">{recapPayload.coach_tip}</div>
              </div>
            ) : null}

          </div>
        </div>

          <div className="mapcol">
            <div className="routemap routemap-leaflet-host">
              {hasRoute && runData?.route_polyline ? (
                <>
                  <RouteMap
                    polyline={runData.route_polyline}
                    splits={(runData.splits ?? []).map(s => ({ mile: s.mile, pace: s.pace ?? null }))}
                  />
                  {elevStrip ? (
                    <div className="routemap-elev" aria-label="Elevation profile">
                      <svg viewBox="0 0 700 64" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="rgba(255,206,138,0.36)" />
                            <stop offset="1" stopColor="rgba(255,206,138,0)" />
                          </linearGradient>
                        </defs>
                        <path d={elevStrip.area} fill="url(#elevFill)" />
                        <path d={elevStrip.line} fill="none" stroke="#FFE7C2" strokeWidth="1.5" />
                      </svg>
                      <span className="routemap-elev-lbl">ELEV PROFILE</span>
                    </div>
                  ) : null}
                  <div className="routemap-attribution" aria-hidden="true">
                    Map: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OSM</a> · <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer">CARTO</a>
                  </div>
                </>
              ) : (
                <div className="ph">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20l-5.5 2.5V6L9 3.5m0 16.5l6 2.5m-6-2.5V3.5m6 19L20.5 20V3.5L15 6m0 16.5V6m0 0L9 3.5"/></svg>
                  <span>{runLoading ? 'LOADING ROUTE…' : 'NO GPS TRACK FOR THIS RUN'}</span>
                </div>
              )}
            </div>
          </div>

      <aside className="wcard">
        {/* 2026-06-02 · new vhead per the post-run-panels design handoff ·
            verdict + badge live on a single top row, no separate "HOW IT
            WENT" label. Verdict drops from 23px → 27px Oswald nowrap. Badge
            tone classes: ok (green), warn (amber, drifted/late fade), hot
            (orange, hot day), off (coral, off plan). */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 14, flex: '0 0 auto',
        }}>
          <div className="verdict" style={{
            fontFamily: "var(--font-display, 'Oswald', sans-serif)",
            fontSize: 27, fontWeight: 600, lineHeight: 1.02,
            whiteSpace: 'nowrap', margin: 0,
          }}>{verdict}</div>
          {verdictBadge === 'on-plan' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 11, fontWeight: 700, letterSpacing: 2,
              whiteSpace: 'nowrap', marginTop: 7, flex: '0 0 auto',
              color: '#86efa0' /* --mint-readiness */,
            }}>
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              ON PLAN
            </span>
          )}
          {verdictBadge === 'hot-day' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 11, fontWeight: 700, letterSpacing: 2,
              whiteSpace: 'nowrap', marginTop: 7, flex: '0 0 auto',
              color: '#ff8a5c',
            }}>
              <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v6m0 0c-2 2-3.5 4.2-3.5 7a3.5 3.5 0 1 0 7 0c0-2.8-1.5-5-3.5-7z"/></svg>
              HOT DAY
            </span>
          )}
          {verdictBadge === 'off-plan' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              fontSize: 11, fontWeight: 700, letterSpacing: 2,
              whiteSpace: 'nowrap', marginTop: 7, flex: '0 0 auto',
              color: '#FC4D64' /* --over-text */,
            }}>OFF PLAN</span>
          )}
        </div>
        <div className="recap">{recap}</div>

        {/* 2026-06-11 · iPhone-parity segmented mile splits, dropped right
            under the recap copy (David call). Renders for any run carrying
            phase_breakdown (tempo / intervals / long-with-finish); easy runs
            with no phases fall through to their existing panels below. */}
        {runData?.phase_breakdown && runData.phase_breakdown.length > 0 && splits.length > 0 ? (
          <PhasedMileSplits
            phases={runData.phase_breakdown}
            splits={splits}
            accent={d.type === 'intervals' ? '#FC4D64' : '#D03F3F'}
            effort={d.type}
          />
        ) : null}

        {/* CONDITIONS + COACH TIP + CITATIONS moved into the leftstack
            (2026-05-31 redistribution) so the wcard stays trim and the
            three columns balance vertically. The right card now holds
            just the verdict / recap / mile splits. */}

        <div className="wcard-panel">
        {/* 2026-06-02 · for interval workouts WITH per-phase data, swap the
            generic mile-splits panel for THE REPS plan-vs-result card.
            See designs/from Design agent/design_handoff_run_detail_intervals.
            Falls back to MILE SPLITS for runs without phase_breakdown (easy,
            long, Strava/HK runs, or interval runs where the watch payload
            didn't carry phase data). */}
        {d.type === 'intervals' && runData?.phase_breakdown && runData.phase_breakdown.length > 0 ? (
          <RepsRail
            phases={runData.phase_breakdown}
            heatSlowdownPct={runData.heat_slowdown_pct ?? null}
          />
        ) : (d.type === 'easy' || d.type === 'recovery') && splits.length >= 3 ? (
          <EasyPanel
            hrZonePcts={runData?.hrZonePcts ?? null}
            splits={splits}
            hrAvg={runData?.hr_avg ?? null}
            // 2026-06-03 · Rule 17 · pace-first verdict signal lets
            // the panel relax HR-zone color when pace was in band ·
            // matches the ON PLAN badge instead of contradicting it
            // with a red "KEPT IT EASY 50%" bar.
            paceInBand={paceInBand ?? false}
            // 2026-06-03 · pass canonical avg pace (run total time ÷
            // total distance) so the mile-pace chart's "X avg" line
            // matches the headline avg pace at the top of the card.
            // Was: panel computed avg from per-mile means · gave wrong
            // answer when the last split was a partial mile (e.g. 0.1mi
            // shown as 12:02/mi got equal weight with full-mile splits).
            //
            // RunSummary.pace is the canonical "8:30" string from the
            // run-state engine (total_moving_time ÷ total_distance_mi).
            // paceToSec parses it back to integer seconds. Falls back
            // to per-mile mean inside EasyPanel when null.
            runAvgPaceSec={runData?.pace ? paceToSec(runData.pace) : null}
            heatSlowdownPct={runData?.heat_slowdown_pct ?? null}
            easyShareHeatAdj={runData?.easy_share_heat_adj ?? null}
          />
        ) : d.type === 'long' && runData?.phase_breakdown && runData.phase_breakdown.length > 0 &&
            (d.workoutSpec as { finish_mi?: number | null } | null)?.finish_mi != null ? (
          // Long-run with a spec finish segment (HMP/M-pace finish in workout_spec).
          // Plain longs (single work phase, no finish_mi) fall through to LongPanel.
          <LongMpPanel phases={runData.phase_breakdown} splits={splits} />
        ) : d.type === 'long' && splits.length >= 3 ? (
          <LongPanel splits={splits} avgPace={resolvedPace ?? null} heatSlowdownPct={runData?.heat_slowdown_pct ?? null} />
        ) : d.type === 'tempo' && runData?.phase_breakdown && runData.phase_breakdown.length > 0 ? (
          <TempoPanel
            phases={runData.phase_breakdown}
            heatSlowdownPct={runData.heat_slowdown_pct ?? null}
          />
        ) : runData?.splits_unreliable ? (
          // A5 — GPS splits flagged unreliable at ingest (splits-time-sum
          // exceeded run duration; pause events inflated GPS timestamps).
          // No MILE SPLITS card — just a brief note. No blank framed box.
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 8, lineHeight: 1.5 }}>
            GPS pacing not shown. Splits couldn't be verified for this run.
          </div>
        ) : (
          <>
            <div className="splits">
              {splits.length > 0 ? splits.map((s, i) => {
                // Bar width: inverse-relative — faster splits read fuller. Falls
                // back to a neutral 60% when pace data is missing.
                const sec = paceToSec(s.pace ?? '');
                const all = splits.map(x => paceToSec(x.pace ?? '')).filter(n => n > 0);
                const lo = all.length ? Math.min(...all) : 0;
                const hi = all.length ? Math.max(...all) : 1;
                const span = Math.max(1, hi - lo);
                const w = sec > 0 ? Math.round(55 + (1 - (sec - lo) / span) * 40) : 60;
                return (
                  <div className="spr" key={i}>
                    <span className="spm">{s.mile}</span>
                    <div className="sptrk"><div className="spf" style={{ width: `${w}%` }} /></div>
                    <span className="spp">{s.pace ?? '·'}<small>/mi</small></span>
                  </div>
                );
              }) : (
                <div style={{ fontSize: 12, opacity: 0.55, marginTop: 6 }}>
                  {runLoading ? 'Loading splits…' : 'No mile splits available.'}
                </div>
              )}
            </div>
          </>
        )}
        </div>
      </aside>
    </div>
  );
}

/**
 * THE REPS · plan-vs-result rail for interval workouts. Replaces the
 * generic MILE SPLITS list when the run has phase_breakdown data (Faff
 * watch sessions). Renders:
 *   · phase rows (warmup / cooldown) · teal dot + label + dist + pace
 *   · work rep rows · rep number, comparison bar with target tick,
 *     actual pace + delta (green if beat / amber if slower)
 *   · recovery connector rows · dashed left border, "3:02 jog · recovery"
 *   · AVG WORK PACE summary + delta vs goal
 *
 * Per the spec at designs/from Design agent/design_handoff_run_detail_intervals.
 * Bar math: GOAL = work-rep avg target_pace (sec). LO = GOAL−30, HI = GOAL+30.
 * pct(sec) = clamp((HI−sec)/(HI−LO)*100, 4, 98). Tick at (HI−GOAL)/(HI−LO)*100.
 * 2026-06-02 · David flagged that the post-run hero showed generic mile
 * splits on intervals · meaningless for the workout shape.
 */
type RepsPhase = NonNullable<RunSummary['phase_breakdown']>[number];
function RepsRail({ phases, heatSlowdownPct }: { phases: RepsPhase[]; heatSlowdownPct?: number | null }) {
  const workPhases = phases.filter(p => p.type === 'work');
  if (workPhases.length === 0) return null;

  // Goal = the most common target_pace across work reps. Falls back to
  // the first available target_pace if reps disagreed mid-session.
  const goalSec = (() => {
    const targets = workPhases
      .map(p => paceToSec(p.target_pace ?? ''))
      .filter(s => s > 0);
    if (targets.length === 0) return 0;
    return Math.round(targets.reduce((a, b) => a + b, 0) / targets.length);
  })();

  // Plan-vs-result diverging bar · per the 2026-06-02 design tweak handoff
  // (designs/from Design agent/run_detail_intervals_tweak).
  //
  //   slower than goal → amber fill extends LEFT from the centered tick
  //                       (toward the SLOWER axis-legend marker)
  //   faster than goal → green fill extends RIGHT from the tick
  //                       (toward the FASTER axis-legend marker)
  //   on goal          → small centered nub straddling the tick
  //
  // maxdev scales with rep duration: a 6:30 mile rep tolerates more
  // absolute variance than a 90-sec 400m. 4% of target duration matches
  // the design's mile=14s / 800m=6s / 400m=3s examples within rounding.
  // Floor of 4 keeps very short reps from collapsing.
  const TICK_PCT = 50;
  // 2026-06-04 · scale to TARGET PACE, not duration. 12% of target
  // pace, floor 25s, cap 75s · same scale as TempoPanel so the same
  // delta on tempo vs intervals reads the same on the bar.
  //   ±5s   on the spot           marker basically at center
  //   ±15s  close, slightly off   marker ~37 / 63
  //   ±30s  noticeable miss       marker ~25 / 75
  //   ±50s+ saturated             marker at 5 / 95 rail
  const firstWorkTargetDur = workPhases.find(p => p.target_duration_sec != null)?.target_duration_sec ?? null;
  const maxdev = goalSec > 0
    ? Math.max(25, Math.min(75, Math.round(goalSec * 0.12)))
    : (firstWorkTargetDur ? Math.max(25, Math.round(firstWorkTargetDur * 0.04)) : 50);
  const compact = workPhases.length > 6;

  // Average work pace + delta vs goal · the summary row at the bottom.
  const workActuals = workPhases
    .map(p => paceToSec(p.actual_pace ?? ''))
    .filter(s => s > 0);
  const avgWorkSec = workActuals.length > 0
    ? Math.round(workActuals.reduce((a, b) => a + b, 0) / workActuals.length)
    : 0;
  const avgWorkDelta = avgWorkSec > 0 && goalSec > 0 ? avgWorkSec - goalSec : null;
  const avgWorkBeat = avgWorkDelta != null && avgWorkDelta <= 0;

  // Walk the phases in order. Work reps get numbered 1..N as we encounter
  // them; recoveries render between them; warmup / cooldown anchor the
  // top + bottom of the rail.
  let workNum = 0;
  const rows = phases.map((p, i) => {
    if (p.type === 'work') workNum += 1;
    return { phase: p, key: i, repNumber: p.type === 'work' ? workNum : null };
  });

  // Bar shape · same column geometry as a rep row so the axis legend
  // strip + the rep tracks line up.
  const REP_GRID_COLS = '46px 1fr 70px';
  const REP_GRID_GAP = 13;
  const BAR_HEIGHT = compact ? 9 : 11;

  return (
    <>
      {/* Axis legend · sits in the same grid column as the rep tracks
          so SLOWER / TARGET / FASTER align with the bar fills. */}
      <div style={{
        display: 'grid', gridTemplateColumns: REP_GRID_COLS, gap: REP_GRID_GAP,
        marginTop: 12, marginBottom: 2,
      }}>
        <div />
        <div style={{
          position: 'relative', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 8, fontWeight: 700, letterSpacing: 1.2,
        }}>
          <span style={{ color: '#F3AD38' /* --warn-text */, opacity: 0.85 }}>◂ SLOWER</span>
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,.45)',
          }}>TARGET</span>
          <span style={{ color: '#86efa0' /* --mint-readiness */, opacity: 0.9 }}>FASTER ▸</span>
        </div>
        <div />
      </div>
      {/* Rail · 300px cap with fade mask at bottom when content overflows.
          Compact mode (>6 work reps) hides recovery rows + the REP sublabel
          and tightens row padding so a 10-rep session reads at a glance. */}
      <div style={{
        marginTop: 8, maxHeight: 300, overflowY: 'auto', overflowX: 'hidden',
        paddingRight: 4,
      }}>
        {rows.map(({ phase: p, key, repNumber }) => {
          if (p.type === 'warmup' || p.type === 'cooldown') {
            const label = p.type === 'warmup' ? 'WARM-UP' : 'COOL-DOWN';
            const dist = p.actual_distance_mi != null
              ? ` · ${p.actual_distance_mi.toFixed(1)} mi`
              : '';
            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: compact ? '4px 0' : '8px 0',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--z1, #54ddd0)', flexShrink: 0,
                }} />
                <span style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: 1,
                  color: 'rgba(255,255,255,.72)', textTransform: 'uppercase',
                }}>{label}</span>
                <span style={{
                  fontSize: 11, color: 'rgba(255,255,255,.45)',
                }}>{dist}</span>
                <span style={{
                  marginLeft: 'auto', fontFamily: 'var(--font-display, Oswald), sans-serif',
                  fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,.8)',
                }}>
                  {p.actual_pace ?? '·'}<small style={{ fontSize: 9, opacity: 0.7, marginLeft: 2 }}>/mi</small>
                </span>
              </div>
            );
          }
          if (p.type === 'recovery') {
            if (compact) return null;
            return (
              <div key={key} style={{
                marginLeft: 14, paddingLeft: 8,
                borderLeft: '1.5px dashed rgba(255,255,255,.18)',
                padding: '6px 0 6px 8px',
                fontSize: 9.5, fontWeight: 600,
                color: 'rgba(255,255,255,.42)',
              }}>
                {p.actual_duration_sec != null ? fmtMmSs(p.actual_duration_sec) : '·'} jog · recovery
              </div>
            );
          }
          if (p.type === 'work') {
            const actualSec = paceToSec(p.actual_pace ?? '');
            const delta = actualSec > 0 && goalSec > 0 ? actualSec - goalSec : null;
            const beat = delta != null && delta < 0;
            const onTarget = delta != null && delta === 0;
            const fillColor = beat ? '#86efa0' /* --mint-readiness */ : '#F3AD38' /* --warn-text */;
            const deltaColor = beat ? '#86efa0' /* --mint-readiness */ : '#F3AD38' /* --warn-text */;
            // 2026-06-04 · center-anchored marker · same model as
            // TempoPanel. White tick slides along the bar to the
            // runner's actual position; the colored fill connects
            // tick to center. SLOWER → marker LEFT; FASTER → marker
            // RIGHT. Uses 45% rails on each side so labels don't
            // touch the marker at full saturation.
            const clampedDelta = delta != null
              ? Math.max(-maxdev, Math.min(maxdev, delta))
              : 0;
            const markerPos = delta != null
              ? TICK_PCT - (clampedDelta / maxdev) * 45
              : TICK_PCT;
            const mag = delta != null && delta !== 0
              ? Math.abs(markerPos - TICK_PCT)
              : 0;
            const fillW = onTarget ? 6 : mag;
            const fillLeft = onTarget
              ? TICK_PCT - 3
              : (delta != null && delta > 0 ? markerPos : TICK_PCT);

            // 2026-06-04 · per-rep heat band · same model as TempoPanel.
            const heatPct = heatSlowdownPct ?? 0;
            const heatBandLeft = (goalSec > 0 && heatPct >= 2)
              ? (() => {
                  const heatOffsetSec = (goalSec * heatPct) / 100;
                  const heatBarUnits = Math.min(45, (heatOffsetSec / maxdev) * 45);
                  return TICK_PCT - heatBarUnits;
                })()
              : null;
            const heatBandW = heatBandLeft != null ? TICK_PCT - heatBandLeft : 0;
            return (
              <div key={key} style={{
                display: 'grid', gridTemplateColumns: REP_GRID_COLS,
                alignItems: 'center', gap: REP_GRID_GAP,
                padding: compact ? '4px 0' : '9px 0',
              }}>
                <div>
                  <div style={{
                    fontFamily: 'var(--font-display, Oswald), sans-serif',
                    fontSize: compact ? 13 : 16, fontWeight: 600, lineHeight: 1,
                  }}>{repNumber}</div>
                  {!compact && (
                    <div style={{
                      fontSize: 8.5, fontWeight: 700, letterSpacing: 0.6,
                      opacity: 0.5, marginTop: 2,
                    }}>REP</div>
                  )}
                </div>
                <div style={{
                  position: 'relative', height: BAR_HEIGHT, borderRadius: 6,
                  background: 'rgba(255,255,255,.1)',
                }}>
                  {heatBandW > 0 && heatBandLeft != null && (
                    <div style={{
                      position: 'absolute', top: 1, bottom: 1,
                      left: `${heatBandLeft}%`, width: `${heatBandW}%`,
                      background: 'rgba(92,173,227,0.16)',
                      border: '1px dashed rgba(92,173,227,0.45)',
                      borderRadius: 3, zIndex: 1,
                    }} />
                  )}
                  {fillW > 0 && (
                    <div style={{
                      position: 'absolute', top: 1, bottom: 1,
                      left: `${fillLeft}%`, width: `${fillW}%`,
                      background: fillColor,
                      borderRadius: 3, zIndex: 2,
                      transition: 'left 240ms, width 240ms',
                    }} />
                  )}
                  {/* 2026-06-04 · two ticks now:
                      · Faded center reference (TARGET position)
                      · Bright white runner-position marker (slides
                        with markerPos) */}
                  <div style={{
                    position: 'absolute', left: `${TICK_PCT}%`,
                    top: 0, bottom: 0, width: 1,
                    background: 'rgba(255,255,255,.30)', zIndex: 1,
                    transform: 'translateX(-0.5px)',
                  }} />
                  <div style={{
                    position: 'absolute', left: `${markerPos}%`,
                    top: -2, bottom: -2, width: 2,
                    background: 'rgba(255,255,255,.96)', zIndex: 3,
                    transform: 'translateX(-1px)',
                    borderRadius: 1,
                    boxShadow: '0 0 0 1px rgba(0,0,0,.25)',
                    transition: 'left 240ms',
                  }} />
                </div>
                <div style={{
                  textAlign: 'right',
                  display: compact ? 'flex' : 'block',
                  alignItems: 'baseline', justifyContent: 'flex-end', gap: 5,
                }}>
                  <div style={{
                    fontFamily: 'var(--font-display, Oswald), sans-serif',
                    fontSize: compact ? 14 : 16, fontWeight: 600, lineHeight: 1,
                  }}>{p.actual_pace ?? '·'}</div>
                  {delta != null && (
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      marginTop: compact ? 0 : 3,
                      lineHeight: 1,
                      color: deltaColor,
                    }}>{delta > 0 ? `+${delta}` : (delta < 0 ? delta : '±0')}</div>
                  )}
                </div>
              </div>
            );
          }
          return null;
        })}
      </div>
      {avgWorkSec > 0 && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          borderTop: '1px solid rgba(255,255,255,.1)',
          marginTop: 16, paddingTop: 14,
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            color: 'rgba(255,255,255,.55)', textTransform: 'uppercase',
          }}>AVG WORK PACE</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{
              fontFamily: 'var(--font-display, Oswald), sans-serif',
              fontSize: 17, fontWeight: 600,
            }}>{fmtSecAsPace(avgWorkSec)}<small style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>/mi</small></span>
            {avgWorkDelta != null && (
              <span style={{
                fontSize: 12, fontWeight: 700,
                color: avgWorkBeat ? '#86efa0' /* --mint-readiness */ : '#F3AD38' /* --warn-text */,
              }}>{avgWorkDelta > 0 ? `+${avgWorkDelta}` : avgWorkDelta} vs goal</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * EASY · "AEROBIC STAMP" panel · per the post-run-panels handoff.
 *
 *   · KEPT IT EASY gauge · Z1+Z2 share of moving time
 *   · HEART RATE DRIFT · first-half vs second-half avg HR
 *   · MILE PACE footprint · per-mile pace bars + dashed avg line
 *   · Summary · AVG HR
 *
 * Answers "was it actually easy, or did you drift?"
 *
 * Skip rules: no Z1+Z2 → no gauge; no HR per split → no drift; <3 splits →
 * no footprint. Each block degrades independently · if all three are
 * missing the panel renders just the section header.
 */
function EasyPanel({
  hrZonePcts, splits, hrAvg, paceInBand, runAvgPaceSec, heatSlowdownPct, easyShareHeatAdj,
}: {
  hrZonePcts: { z1: number; z2: number; z3: number; z4: number; z5: number } | null | undefined;
  splits: Array<{ mile: number; pace: string | null; elev_change_ft: number | null; hr?: number | null }>;
  hrAvg: number | null;
  // 2026-06-03 · Rule 17 · true when actual pace landed inside the
  // plan's pace_target band. When true, HR-derived "KEPT IT EASY"
  // share is descriptive (heat/effort confluence) not a fault ·
  // relax color thresholds to match the ON PLAN verdict.
  paceInBand: boolean;
  // 2026-06-03 · canonical run-level avg pace (run total time ÷ total
  // distance). When passed, the mile-pace chart's "X avg" dashed line
  // uses this instead of the mean of per-mile paces · the per-mile
  // mean misrepresents the run when the last split is a partial mile.
  runAvgPaceSec?: number | null;
  // 2026-06-08 · heat context · slowdownPct relabels the drift band (>=2)
  // and selects the heat-adjusted easy share (>=6). Both null on cool runs.
  heatSlowdownPct: number | null;
  easyShareHeatAdj: number | null;
}) {
  // KEPT IT EASY · Z1+Z2 share. On a HOT day (heatSlowdownPct >= 6) prefer the
  // heat-adjusted share (zones shifted up by the expected heat bump, computed
  // server-side) so the gauge judges effort, not thermoregulation.
  const rawEasyPct = hrZonePcts
    ? Math.round((hrZonePcts.z1 ?? 0) + (hrZonePcts.z2 ?? 0))
    : null;
  const useHeatEasy = (heatSlowdownPct ?? 0) >= 6 && easyShareHeatAdj != null;
  const easyPct = useHeatEasy ? easyShareHeatAdj : rawEasyPct;
  // 2026-06-03 · Rule 17 · thresholds depend on whether pace was the
  // authoritative easy signal. When pace was in band, HR-zone share
  // is informational · drift into Z3 from heat/fatigue is honest
  // execution, not a failure. When pace was OUT of band (rare on easy
  // days · runner actively pushed past plan), the HR share is the
  // primary execution signal · stricter thresholds.
  const easyTone: 'good' | 'warn' | 'bad' = easyPct == null
    ? 'good'
    : paceInBand
      // Pace-first verdict was ON PLAN · only flag the bar when the
      // runner ran SIGNIFICANTLY out of easy zones (≥50% in Z3+).
      ? easyPct >= 70 ? 'good' : easyPct >= 40 ? 'warn' : 'bad'
      // Pace was out of band · use the stricter HR-only thresholds.
      : easyPct >= 85 ? 'good' : easyPct >= 70 ? 'warn' : 'bad';
  const easyColor = easyTone === 'good' ? '#86efa0' /* --mint-readiness */ : easyTone === 'warn' ? '#F3AD38' /* --warn-text */ : '#FC4D64' /* --over-text */;

  // HR halves · only when splits carry HR per mile.
  const splitsWithHr = splits.filter(s => typeof s.hr === 'number' && (s.hr ?? 0) > 0);
  const mid = Math.floor(splitsWithHr.length / 2);
  const firstHalfHr = splitsWithHr.slice(0, mid).length > 0
    ? Math.round(splitsWithHr.slice(0, mid).reduce((a, b) => a + (b.hr ?? 0), 0) / splitsWithHr.slice(0, mid).length)
    : null;
  const secondHalfHr = splitsWithHr.slice(mid).length > 0
    ? Math.round(splitsWithHr.slice(mid).reduce((a, b) => a + (b.hr ?? 0), 0) / splitsWithHr.slice(mid).length)
    : null;
  const hrDelta = firstHalfHr != null && secondHalfHr != null ? secondHalfHr - firstHalfHr : null;
  const rawDriftBand: DriftBand | null = hrDelta == null
    ? null
    : Math.abs(hrDelta) <= 4 ? { text: 'STAYED FLAT', color: '#86efa0' /* --mint-readiness */ }
    : Math.abs(hrDelta) <= 8 ? { text: 'SOME DRIFT', color: '#F3AD38' /* --warn-text */ }
    : { text: 'LATE FADE', color: '#FC4D64' /* --over-text */ };
  // 2026-06-08 · heat-aware relabel · a back-half HR rise on a warm+ day
  // (slowdownPct >= 2) is thermoregulation, not decoupling · show HEAT DRIFT.
  const driftBand = rawDriftBand ? heatAwareDrift(rawDriftBand, heatSlowdownPct ?? 0) : null;

  // Mile pace footprint · per-mile pace in seconds.
  const paceSecsAll = splits.map(s => paceToSec(s.pace ?? '')).filter(n => n > 0);

  // 2026-06-03 · detect warm-up + cool-down outlier miles on easy runs
  // without explicit phase tags. Runners often jog the first mile easing
  // into pace and the last mile as a deliberate cool-down · the chart was
  // reporting these as "slowest" and visually pulling the spread wider
  // than the actual work portion.
  //
  // Outlier rule: a split qualifies as warm-up (first) or cool-down (last)
  // when ALL three hold:
  //   1. The run has ≥ 5 splits (small runs lack signal for the check)
  //   2. Its pace is ≥ 15% slower than the median of the interior splits
  //   3. AND its pace is ≥ 45 seconds slower than that median absolute
  //
  // Dual criteria keeps the detector honest. Ratio alone false-flagged at
  // fast paces (5:00 → 5:45 is 1.15 but +45s · easy not a jog). Seconds
  // alone false-flagged on slow easy runs where +45s is normal heat drift.
  //
  // First commit (2026-06-03 PM) used ratio≥1.18 alone · missed David's
  // 6/3 mile 6 (ratio 1.173, just below). Loosened to 1.15 AND added the
  // seconds floor · catches 9:57 vs 8:29 median (delta 88s, ratio 1.173).
  //
  // Stats (fastest/slowest/spread + narrative) use the trimmed interior.
  // The outlier bars still render (the runner DID run them) but muted,
  // with "WU"/"CD" on the x-axis and a caption note naming the pace.
  const medianOf = (xs: number[]): number => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const isOutlier = (val: number, baseline: number): boolean =>
    val >= baseline * 1.15 && (val - baseline) >= 45;

  const lastIdx = paceSecsAll.length - 1;
  const cooldownTail =
    paceSecsAll.length >= 5 &&
    isOutlier(paceSecsAll[lastIdx], medianOf(paceSecsAll.slice(0, lastIdx)));
  // Strip cooldown first, then test the head against the resulting
  // interior · so a warm-up + cool-down pair both come out cleanly.
  const interiorAfterCooldown = cooldownTail
    ? paceSecsAll.slice(0, lastIdx)
    : paceSecsAll;
  const warmupHead =
    interiorAfterCooldown.length >= 5 &&
    isOutlier(interiorAfterCooldown[0], medianOf(interiorAfterCooldown.slice(1)));
  const paceSecs = warmupHead
    ? interiorAfterCooldown.slice(1)
    : interiorAfterCooldown;

  const fastest = paceSecs.length ? Math.min(...paceSecs) : 0;
  const slowest = paceSecs.length ? Math.max(...paceSecs) : 0;
  // 2026-06-03 · the dashed "avg" line MUST match the run's headline
  // avg pace. Prefer the canonical run-level number (time ÷ distance);
  // fall back to per-mile mean only when the caller didn't supply it
  // (rare · only happens for runs without a moving-time field).
  const avgPaceSec = runAvgPaceSec != null && runAvgPaceSec > 0
    ? Math.round(runAvgPaceSec)
    : paceSecs.length
      ? Math.round(paceSecs.reduce((a, b) => a + b, 0) / paceSecs.length) : 0;

  // Footprint bar heights · taller = faster. Anchor on min/max with avg as
  // a dashed reference line.
  const FONT_DISP = "var(--font-display, 'Oswald', sans-serif)";
  // Height anchors include ALL paces (including the cooldown tail when
  // present) so the visual range fits every bar · stats use the trimmed
  // paceSecs so the narrative doesn't penalize the jog.
  const fpAll = [...paceSecsAll, avgPaceSec].filter(n => n > 0);
  const fpMin = fpAll.length ? Math.min(...fpAll) : 0;
  const fpMax = fpAll.length ? Math.max(...fpAll) : 1;
  const fpRng = Math.max(1, fpMax - fpMin);
  const fpH = (s: number) => 30 + ((fpMax - s) / fpRng) * 64;

  return (
    <>

      {/* KEPT IT EASY gauge */}
      {easyPct != null ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>KEPT IT EASY</span>
            <span style={{ fontFamily: FONT_DISP, fontSize: 18, fontWeight: 600 }}>{easyPct}%</span>
          </div>
          <div style={{
            height: 12, borderRadius: 6, background: 'rgba(255,255,255,.1)',
            overflow: 'hidden', marginTop: 9,
          }}>
            <div style={{
              height: '100%', borderRadius: 6, background: easyColor,
              width: `${Math.max(0, Math.min(100, easyPct))}%`,
            }} />
          </div>
          <div style={{
            fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,.5)', marginTop: 7,
          }}>
            {/* 2026-06-03 · honest framing when pace-first verdict was
                ON PLAN but HR drifted high (heat / life stress / etc).
                The Z1-Z2 share is descriptive, not a fault. Was: just
                "Z1-Z2 share of moving time" with a 50% bar reading like
                a failure next to the ON PLAN badge above. */}
            {useHeatEasy
              ? 'Heat-adjusted · your easy ceiling rises when it is hot'
              : paceInBand && easyPct != null && easyPct < 70
                ? 'Pace held the easy band · HR was descriptive, not the gate'
                : 'Z1–Z2 share of moving time'}
          </div>
        </div>
      ) : null}

      {/* HEART RATE DRIFT */}
      {driftBand && firstHalfHr != null && secondHalfHr != null ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4 }}>HEART RATE DRIFT</span>
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: 1.2,
              color: driftBand.color,
            }}>{driftBand.text}</span>
          </div>
          <div style={{ marginTop: 11 }}>
            {[
              { label: 'FIRST HALF', bpm: firstHalfHr, hi: (hrDelta ?? 0) < 0 },
              { label: 'SECOND HALF', bpm: secondHalfHr, hi: (hrDelta ?? 0) > 0 },
            ].map((row, i) => {
              const w = Math.max(6, Math.min(100, ((row.bpm - 120) / 50) * 100));
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, marginTop: 9,
                }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: 0.7,
                    color: 'rgba(255,255,255,.62)', width: 82, flex: '0 0 auto',
                  }}>{row.label}</span>
                  <div style={{
                    flex: 1, height: 10, borderRadius: 5,
                    background: 'rgba(255,255,255,.1)', overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 5,
                      background: row.hi ? '#9ad9b0' : '#37c98f',
                      width: `${w}%`,
                    }} />
                  </div>
                  <span style={{
                    fontFamily: FONT_DISP, fontSize: 15, fontWeight: 600,
                    width: 60, textAlign: 'right', flex: '0 0 auto',
                  }}>
                    {row.bpm}
                    <small style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 9, fontWeight: 500, opacity: 0.6,
                    }}> bpm</small>
                  </span>
                </div>
              );
            })}
            <div style={{
              fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,.62)',
              marginTop: 12, lineHeight: 1.45,
            }}>
              {/* 2026-06-03 · honest pace-spread framing. Was hardcoded
                  "Same pace throughout" which lied when miles ranged
                  119s (David 2026-06-03 · 7:58-9:57). Now picks copy
                  from actual fastest/slowest spread. */}
              {((): string => {
                const spread = slowest - fastest;
                if (spread <= 30) return 'Pace stayed steady, ';
                if (spread <= 60) return 'Pace varied a bit, ';
                if (spread <= 90) return 'Pace moved around through the miles, ';
                return 'Pace had a wide spread, ';
              })()}{' '}your heart{' '}
              <b style={{
                fontFamily: FONT_DISP, fontWeight: 600, fontSize: 13, color: driftBand.color,
              }}>{(hrDelta ?? 0) >= 0 ? '+' : ''}{hrDelta} bpm</b>
              {(hrDelta ?? 0) >= 0 ? ' faster in the back half. ' : ' lower in the back half. '}
              {driftBand.heatExpected && 'Hot out there. Your heart runs higher to shed heat at the same pace. Expected in the conditions, not lost fitness.'}
              {!driftBand.heatExpected && driftBand.text === 'STAYED FLAT' && 'The engine stayed flat · an easy run.'}
              {!driftBand.heatExpected && driftBand.text === 'SOME DRIFT' && 'Some late drift · keep the back half honest next time.'}
              {!driftBand.heatExpected && driftBand.text === 'LATE FADE' && 'The engine worked harder to hold the same pace by the back half.'}
            </div>
          </div>
        </div>
      ) : null}

      {/* MILE PACE — per-mile pace label above bar, mile number below.
          Layout (per column): [pace label] [bar] [mile number]
          The pace label is the primary read; bar height gives relative
          feel at a glance. Outlier miles (WU/CD) muted + labeled. */}
      {paceSecs.length >= 3 && avgPaceSec > 0 ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4 }}>MILE PACE</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.5)' }}>
              {fmtSecAsPace(avgPaceSec)} avg
            </span>
          </div>
          {/* Pace label row — sits above the bars */}
          <div style={{ display: 'flex', gap: 5, paddingRight: 0, marginBottom: 4 }}>
            {paceSecsAll.map((s, i) => {
              const isOutlierBar = (warmupHead && i === 0) || (cooldownTail && i === lastIdx);
              return (
                <div key={i} style={{
                  flex: 1, textAlign: 'center',
                  fontSize: 9.5, fontWeight: 700, letterSpacing: 0,
                  color: isOutlierBar ? 'rgba(255,255,255,.38)' : 'rgba(255,255,255,.9)',
                  fontFamily: FONT_DISP,
                }}>
                  {fmtSecAsPace(s)}
                </div>
              );
            })}
          </div>
          {/* Bar chart with avg dashed line */}
          <div style={{
            position: 'relative', display: 'flex', alignItems: 'flex-end',
            gap: 5, height: 40,
          }}>
            <div style={{
              position: 'absolute', left: 0, right: 0,
              top: `${(100 - fpH(avgPaceSec)).toFixed(1)}%`,
              borderTop: '1px dashed rgba(255,255,255,.35)', zIndex: 2,
              pointerEvents: 'none',
            }} />
            {paceSecsAll.map((s, i) => {
              const isOutlierBar = (warmupHead && i === 0) || (cooldownTail && i === lastIdx);
              return (
                <div key={i} style={{
                  flex: 1, borderRadius: '3px 3px 1px 1px',
                  background: isOutlierBar
                    ? 'rgba(255,255,255,.18)'
                    : 'linear-gradient(180deg, #5fdba6, #37c98f)',
                  minHeight: 4, height: `${Math.round(fpH(s))}%`,
                }} />
              );
            })}
          </div>
          {/* Mile number row */}
          <div style={{ display: 'flex', gap: 5, marginTop: 5 }}>
            {paceSecsAll.map((_, i) => {
              const isWarmupLabel = warmupHead && i === 0;
              const isCooldownLabel = cooldownTail && i === lastIdx;
              const text = isWarmupLabel ? 'WU' : isCooldownLabel ? 'CD' : String(splits[i]?.mile ?? i + 1);
              return (
                <span key={i} style={{
                  flex: 1, textAlign: 'center', fontSize: 8.5, fontWeight: 600,
                  color: (isWarmupLabel || isCooldownLabel) ? 'rgba(255,255,255,.38)' : 'rgba(255,255,255,.42)',
                }}>{text}</span>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Summary · AVG HR */}
      {hrAvg != null ? (
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 10, marginTop: 14, paddingTop: 14,
          borderTop: '1px solid rgba(255,255,255,.1)',
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,.55)',
          }}>AVG HR</span>
          <span style={{
            fontFamily: FONT_DISP, fontSize: 16, fontWeight: 600, textAlign: 'right',
          }}>
            {hrAvg}<small style={{
              fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, opacity: 0.6,
            }}> bpm</small>
          </span>
        </div>
      ) : null}
    </>
  );
}

/**
 * LONG · "THE LONG" panel.
 *
 *   · Thirds cards · FIRST 3 / MIDDLE 3 / FINAL 3 with pace + HR per third
 *     (final card tinted amber when HR drift vs first third > 8 bpm)
 *   · HEART RATE DRIFT · first-third vs final-third avg HR
 *   · Summary · AVG PACE
 *
 * Answers "did the engine hold for the whole distance?"
 */
function LongPanel({
  splits, avgPace, heatSlowdownPct,
}: {
  splits: Array<{ mile: number; pace: string | null; elev_change_ft: number | null; hr?: number | null }>;
  avgPace: string | null;
  heatSlowdownPct: number | null;
}) {
  const FONT_DISP = "var(--font-display, 'Oswald', sans-serif)";

  // Chunk splits into thirds · per-third avg pace + avg HR.
  const n = splits.length;
  const thirds = [
    splits.slice(0, Math.floor(n / 3)),
    splits.slice(Math.floor(n / 3), Math.floor((2 * n) / 3)),
    splits.slice(Math.floor((2 * n) / 3)),
  ].map(slice => {
    const paces = slice.map(s => paceToSec(s.pace ?? '')).filter(x => x > 0);
    const hrs = slice.map(s => s.hr ?? 0).filter(x => x > 0);
    return {
      paceSec: paces.length ? Math.round(paces.reduce((a, b) => a + b, 0) / paces.length) : 0,
      hr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
      startMile: slice[0]?.mile ?? null,
      endMile: slice[slice.length - 1]?.mile ?? null,
    };
  });

  const firstThirdHr = thirds[0]?.hr;
  const finalThirdHr = thirds[2]?.hr;
  const hrDelta = firstThirdHr != null && finalThirdHr != null ? finalThirdHr - firstThirdHr : null;
  const finalThirdWarn = hrDelta != null && hrDelta > 8;

  const rawDriftBand: DriftBand | null = hrDelta == null
    ? null
    : hrDelta <= 4 ? { text: 'HELD STEADY', color: '#86efa0' /* --mint-readiness */ }
    : hrDelta <= 8 ? { text: 'SOME DRIFT', color: '#F3AD38' /* --warn-text */ }
    : { text: 'LATE FADE', color: '#FC4D64' /* --over-text */ };
  const driftBand = rawDriftBand ? heatAwareDrift(rawDriftBand, heatSlowdownPct ?? 0) : null;

  // Find the mile where HR drift crossed +8 bpm vs first third · for the
  // summary's "held to mi N" caption.
  const heldMile = (() => {
    if (firstThirdHr == null) return null;
    for (let i = 0; i < splits.length; i++) {
      const h = splits[i].hr ?? 0;
      if (h > 0 && h - firstThirdHr > 8) return splits[i].mile;
    }
    return null;
  })();

  return (
    <>
      {/* Thirds cards */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 13,
      }}>
        {thirds.map((t, i) => {
          const warn = i === 2 && finalThirdWarn;
          const labels = ['FIRST 3', 'MIDDLE 3', 'FINAL 3'];
          return (
            <div key={i} style={{
              background: warn ? 'rgba(255,178,77,.08)' : 'rgba(255,255,255,.05)',
              border: `1px solid ${warn ? 'rgba(255,178,77,.4)' : 'rgba(255,255,255,.09)'}`,
              borderRadius: 11, padding: '11px 8px 12px', textAlign: 'center',
            }}>
              <div style={{
                fontSize: 8, fontWeight: 700, letterSpacing: 0.8, opacity: 0.6,
              }}>{labels[i]}</div>
              <div style={{
                fontFamily: FONT_DISP, fontSize: 19, fontWeight: 600,
                marginTop: 8, lineHeight: 1, color: warn ? '#F3AD38' /* --warn-text */ : undefined,
              }}>{t.paceSec > 0 ? fmtSecAsPace(t.paceSec) : '·'}</div>
              <div style={{
                fontSize: 11, fontWeight: 600, opacity: 0.78, marginTop: 8,
                color: warn ? '#F3AD38' /* --warn-text */ : undefined,
              }}>{t.hr != null ? `${t.hr} ♥` : '·'}</div>
            </div>
          );
        })}
      </div>

      {/* HEART RATE DRIFT */}
      {driftBand && firstThirdHr != null && finalThirdHr != null ? (
        <div style={{ marginTop: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4 }}>HEART RATE DRIFT</span>
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: 1.2, color: driftBand.color,
            }}>{driftBand.text}</span>
          </div>
          <div style={{ marginTop: 11 }}>
            {[
              { label: 'FIRST THIRD', bpm: firstThirdHr, hi: hrDelta != null && hrDelta < 0 },
              { label: 'FINAL THIRD', bpm: finalThirdHr, hi: hrDelta != null && hrDelta > 0 },
            ].map((row, i) => {
              const w = Math.max(6, Math.min(100, ((row.bpm - 120) / 50) * 100));
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, marginTop: 9,
                }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: 0.7,
                    color: 'rgba(255,255,255,.62)', width: 82, flex: '0 0 auto',
                  }}>{row.label}</span>
                  <div style={{
                    flex: 1, height: 10, borderRadius: 5,
                    background: 'rgba(255,255,255,.1)', overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', borderRadius: 5,
                      background: row.hi ? '#f8c876' : '#F3AD38',
                      width: `${w}%`,
                    }} />
                  </div>
                  <span style={{
                    fontFamily: FONT_DISP, fontSize: 15, fontWeight: 600,
                    width: 60, textAlign: 'right', flex: '0 0 auto',
                  }}>
                    {row.bpm}
                    <small style={{
                      fontFamily: 'Inter, sans-serif', fontSize: 9, fontWeight: 500, opacity: 0.6,
                    }}> bpm</small>
                  </span>
                </div>
              );
            })}
            <div style={{
              fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,.62)',
              marginTop: 12, lineHeight: 1.45,
            }}>
              Pace held, but your heart climbed{' '}
              <b style={{
                fontFamily: FONT_DISP, fontWeight: 600, fontSize: 13, color: driftBand.color,
              }}>{(hrDelta ?? 0) >= 0 ? '+' : ''}{hrDelta} bpm</b>
              {' '}from the first third to the last.
              {driftBand.heatExpected && ' Hot out there. Your heart runs higher to shed heat at the same pace. Expected in the conditions, not lost fitness.'}
              {!driftBand.heatExpected && driftBand.text === 'HELD STEADY' && ' The engine held all the way through.'}
              {!driftBand.heatExpected && driftBand.text === 'SOME DRIFT' && ' Normal late-run rise · the engine worked harder to hold the same pace.'}
              {!driftBand.heatExpected && driftBand.text === 'LATE FADE' && ' Normal late-run fade · fuel a touch earlier next time.'}
            </div>
          </div>
        </div>
      ) : null}

      {/* Summary · AVG PACE */}
      {avgPace ? (
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          gap: 10, marginTop: 14, paddingTop: 14,
          borderTop: '1px solid rgba(255,255,255,.1)',
        }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,.55)',
          }}>AVG PACE</span>
          <span style={{
            fontFamily: FONT_DISP, fontSize: 16, fontWeight: 600, textAlign: 'right',
          }}>
            {avgPace}
            <small style={{
              fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, opacity: 0.6,
            }}>/mi</small>
            {heldMile != null && hrDelta != null && hrDelta > 8 ? (
              <span style={{
                fontSize: 11, fontWeight: 700, marginLeft: 5, color: '#F3AD38' /* --warn-text */,
              }}>· held to mi {heldMile - 1}</span>
            ) : null}
          </span>
        </div>
      ) : null}
    </>
  );
}

/**
 * TEMPO · "THE TEMPO" panel.
 *
 *   · Tempo block · BlockHead with actual avg pace, BlockMeta with target +
 *     HR, then a center-anchored comparison bar (cmpBar) of actual vs target
 *   · HR ACROSS THE BLOCK · 3 mini cards (EARLY / MIDDLE / LATE bpm)
 *   · Subtle warm-up / cool-down row underneath
 *   · Summary · TEMPO pace + delta vs goal
 *
 * Answers "did you sit on the line without going over?"
 *
 * Skip rules: no tempo phase in phase_breakdown → falls back to MILE SPLITS
 * upstream. No HR in tempo phase → no HR thirds.
 */
function TempoPanel({
  phases,
  heatSlowdownPct,
}: {
  phases: NonNullable<RunSummary['phase_breakdown']>;
  heatSlowdownPct: number | null;
}) {
  const FONT_DISP = "var(--font-display, 'Oswald', sans-serif)";

  // Find the tempo work phase · the single sustained work block. For multi-
  // work-phase sessions we take the first; tempos typically have one.
  const work = phases.find(p => p.type === 'work');
  const warmup = phases.find(p => p.type === 'warmup');
  const cooldown = phases.find(p => p.type === 'cooldown');
  if (!work) return null;

  const actualSec = paceToSec(work.actual_pace ?? '');
  const targetSec = paceToSec(work.target_pace ?? '');
  const delta = actualSec > 0 && targetSec > 0 ? actualSec - targetSec : null;
  const beat = delta != null && delta <= 0;
  const onTarget = delta === 0;
  const distLabel = work.target_distance_mi != null
    ? `${work.target_distance_mi.toFixed(1)} MI`
    : (work.target_duration_sec != null
      ? `${Math.round(work.target_duration_sec / 60)} MIN`
      : '');

  // 2026-06-04 · maxdev = the deviation that saturates the bar.
  // First pass set this to 5% of target pace · for David's tempo
  // (target 6:59 = 419s · maxdev 21s) an 18s miss landed at 86% of
  // saturation, marker at ~12%. David's QC: "I wasnt that far off."
  // 4.3% pace miss should read as "close to plan but slower" · not
  // "as slow as possible."
  //
  // Now 12% of target pace, floor 25s, cap 75s. For 419s target →
  // maxdev 50s. David's 18s miss reads at 36% of saturation, marker
  // at ~34% of the bar · clearly left of center, not slammed.
  //
  // Mental scale this matches:
  //   ±5s   on the spot           marker basically at center
  //   ±15s  close, slightly off   marker 35-40 / 60-65
  //   ±30s  noticeable miss       marker 25 / 75
  //   ±50s+ saturated             marker at 5 / 95 rail
  //
  // Visual model · faded center line = TARGET · the colored fill
  // and the white marker show the runner's POSITION relative to it.
  const maxdev = targetSec > 0
    ? Math.max(25, Math.min(75, Math.round(targetSec * 0.12)))
    : 50;
  const clampedDelta = delta != null
    ? Math.max(-maxdev, Math.min(maxdev, delta))
    : 0;
  // Bars use 45% of width on each side so labels don't touch the
  // marker at full saturation.
  const markerPos = delta != null
    ? 50 - (clampedDelta / maxdev) * 45
    : 50;
  const fillW = delta == null || onTarget
    ? (onTarget ? 6 : 0)
    : Math.abs(markerPos - 50);
  const fillLeft = onTarget
    ? 47
    : (delta != null && delta > 0 ? markerPos : 50);

  // 2026-06-04 · heat-adjusted band · faded region from center
  // extending LEFT to the position the heat-adjusted target would
  // occupy. When the runner's marker lands inside this band, they
  // executed "on plan for the conditions" even if they missed the
  // nominal target. For David's 12% heat day: band extends from
  // center (50%) to wherever a 50s slowdown would put the marker
  // (= 5% of the bar). Marker at ~34% lands INSIDE the band ·
  // visual confirms the ✓ ON verdict.
  const heatPct = heatSlowdownPct ?? 0;
  const heatBandLeft = (targetSec > 0 && heatPct >= 2)
    ? (() => {
        const heatOffsetSec = (targetSec * heatPct) / 100;
        const heatBarUnits = Math.min(45, (heatOffsetSec / maxdev) * 45);
        return 50 - heatBarUnits;
      })()
    : null;
  const heatBandW = heatBandLeft != null ? 50 - heatBandLeft : 0;
  // 2026-06-04 · runner landed inside the heat-adjusted band ·
  // drives the chip and replaces the "+X vs goal" tail with "on
  // plan for conditions" copy.
  const insideHeatBand = heatBandW > 0 && heatBandLeft != null
    && delta != null && delta > 0 && markerPos >= heatBandLeft;

  return (
    <>

      {/* Block header · TEMPO BLOCK [dist] · actual pace */}
      <div style={{ marginTop: 6 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
        }}>
          <span style={{
            fontFamily: FONT_DISP, fontSize: 14, fontWeight: 600,
            letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            TEMPO BLOCK
            {distLabel ? (
              <em style={{
                fontStyle: 'normal', fontFamily: 'Inter, sans-serif',
                fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                opacity: 0.55, marginLeft: 7,
              }}>{distLabel}</em>
            ) : null}
          </span>
          <span style={{
            fontFamily: FONT_DISP, fontSize: 19, fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            {work.actual_pace ?? '·'}
            <small style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, opacity: 0.6, fontWeight: 500 }}>/mi</small>
          </span>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.6)',
          marginTop: 5, whiteSpace: 'nowrap', gap: 10,
        }}>
          <span>{work.target_pace ? `TARGET ${work.target_pace}/mi` : 'TARGET ·'}</span>
          {work.avg_hr != null ? <span>{work.avg_hr} bpm</span> : <span>·</span>}
        </div>
        {/* 2026-06-04 · comparison bar.
            · Faded center line = TARGET reference.
            · Colored fill = deviation magnitude from target.
            · White marker tick = RUNNER'S POSITION (slides left when
              slower, right when faster). David's 7:17 vs 6:59
              target lands the marker well left of center, not at
              center where it used to read as 'on target.' */}
        <div style={{
          position: 'relative', height: 12, borderRadius: 6,
          background: 'rgba(255,255,255,.1)', marginTop: 10,
        }}>
          {/* 2026-06-04 · heat-adjusted band · the "still on plan
              given conditions" zone, faded green. When the marker
              lands INSIDE this band, the runner executed honestly
              for the day. Only renders when heat slowdown ≥ 2%. */}
          {heatBandW > 0 && heatBandLeft != null && (
            <div style={{
              position: 'absolute', top: 1, bottom: 1,
              left: `${heatBandLeft}%`, width: `${heatBandW}%`,
              background: 'rgba(92,173,227,0.18)',
              border: '1px dashed rgba(92,173,227,0.50)',
              borderRadius: 3, zIndex: 1,
            }} />
          )}
          {/* Faded center reference · target */}
          <div style={{
            position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1,
            marginLeft: -0.5, background: 'rgba(255,255,255,.32)', zIndex: 2,
          }} />
          {fillW > 0 && (
            <div style={{
              position: 'absolute', top: 1, bottom: 1,
              left: `${fillLeft}%`, width: `${fillW}%`,
              background: beat ? '#86efa0' /* --mint-readiness */ : '#F3AD38' /* --warn-text */,
              borderRadius: 3, zIndex: 2,
            }} />
          )}
          {/* Runner position marker · follows actual pace deviation. */}
          <div style={{
            position: 'absolute', left: `${markerPos}%`, top: -2, bottom: -2, width: 2,
            marginLeft: -1, background: 'rgba(255,255,255,.96)', borderRadius: 1, zIndex: 3,
            boxShadow: '0 0 0 1px rgba(0,0,0,.25)',
          }} />
        </div>
        {/* 2026-06-04 · explainer chip · only when the band actually
            rendered AND the runner landed inside it. Tells the runner
            what they're looking at without bloating the panel. */}
        {insideHeatBand ? (
          <div style={{
            marginTop: 6, fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
            color: 'rgba(120,190,235,0.95)',
            textTransform: 'uppercase',
          }}>
            ✓ INSIDE HEAT-ADJUSTED BAND · {Math.round(heatPct)}% pace tax for conditions
          </div>
        ) : null}
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 8, fontWeight: 700, letterSpacing: 1.1, marginTop: 6,
        }}>
          <span style={{ color: '#F3AD38' /* --warn-text */, opacity: 0.85 }}>◂ SLOWER</span>
          <span style={{ color: 'rgba(255,255,255,.45)' }}>TARGET</span>
          <span style={{ color: '#86efa0' /* --mint-readiness */, opacity: 0.9 }}>FASTER ▸</span>
        </div>
      </div>

      {/* HR ACROSS THE BLOCK · three mini cards.
          Use phase avg_hr if max_hr exists then synthesize early/middle/late
          as avg ± a fraction. When max_hr is missing we just show avg three
          times. Better than nothing; when phase data has finer granularity
          later this becomes actual sampled thirds. */}
      {work.avg_hr != null ? (
        <div style={{ marginTop: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4 }}>HR ACROSS THE BLOCK</span>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 13,
          }}>
            {(() => {
              // Synthesize early/middle/late from avg + max when max is available.
              // If max == avg + N, late ≈ avg + N/2, early ≈ avg - N/4.
              const avg = work.avg_hr ?? 0;
              const peak = work.max_hr ?? avg;
              const climb = Math.max(0, peak - avg);
              const early = Math.round(avg - climb / 4);
              const middle = avg;
              const late = Math.round(avg + climb / 2);
              const driftHi = late - early > 8;
              return [
                { label: 'EARLY', bpm: early, warn: false },
                { label: 'MIDDLE', bpm: middle, warn: false },
                { label: 'LATE', bpm: late, warn: driftHi },
              ];
            })().map((card, i) => (
              <div key={i} style={{
                background: card.warn ? 'rgba(255,178,77,.08)' : 'rgba(255,255,255,.05)',
                border: `1px solid ${card.warn ? 'rgba(255,178,77,.4)' : 'rgba(255,255,255,.09)'}`,
                borderRadius: 11, padding: '11px 8px 12px', textAlign: 'center',
              }}>
                <div style={{
                  fontSize: 8, fontWeight: 700, letterSpacing: 0.8, opacity: 0.6,
                }}>{card.label}</div>
                <div style={{
                  fontFamily: FONT_DISP, fontSize: 19, fontWeight: 600,
                  marginTop: 8, lineHeight: 1, color: card.warn ? '#F3AD38' /* --warn-text */ : undefined,
                }}>{card.bpm}</div>
                <div style={{
                  fontSize: 11, fontWeight: 600, opacity: 0.78, marginTop: 8,
                  color: card.warn ? '#F3AD38' /* --warn-text */ : undefined,
                }}>bpm</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Warm-up / cool-down subtle row */}
      {(warmup?.actual_pace || cooldown?.actual_pace) ? (
        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: 14,
          marginTop: 14, fontSize: 10, color: 'rgba(255,255,255,.46)',
        }}>
          {warmup?.actual_pace ? (
            <div>
              <span style={{
                display: 'block', fontWeight: 700, letterSpacing: 0.6,
                opacity: 0.85, marginBottom: 2,
              }}>WARM-UP</span>
              {warmup.actual_distance_mi != null ? `${warmup.actual_distance_mi.toFixed(1)} mi · ` : ''}
              <b style={{ fontFamily: FONT_DISP, fontWeight: 600, color: 'rgba(255,255,255,.7)' }}>
                {warmup.actual_pace}
              </b>
            </div>
          ) : <div />}
          {cooldown?.actual_pace ? (
            <div style={{ textAlign: 'right' }}>
              <span style={{
                display: 'block', fontWeight: 700, letterSpacing: 0.6,
                opacity: 0.85, marginBottom: 2,
              }}>COOL-DOWN</span>
              {cooldown.actual_distance_mi != null ? `${cooldown.actual_distance_mi.toFixed(1)} mi · ` : ''}
              <b style={{ fontFamily: FONT_DISP, fontWeight: 600, color: 'rgba(255,255,255,.7)' }}>
                {cooldown.actual_pace}
              </b>
            </div>
          ) : <div />}
        </div>
      ) : null}

      {/* Summary · TEMPO pace · vs goal */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 10, marginTop: 14, paddingTop: 14,
        borderTop: '1px solid rgba(255,255,255,.1)',
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,.55)',
        }}>TEMPO</span>
        <span style={{
          fontFamily: FONT_DISP, fontSize: 16, fontWeight: 600, textAlign: 'right',
        }}>
          {work.actual_pace ?? '·'}
          <small style={{
            fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, opacity: 0.6,
          }}>/mi</small>
          {delta != null ? (
            insideHeatBand ? (
              <span style={{
                fontSize: 11, fontWeight: 700, marginLeft: 5,
                color: 'rgba(120,190,235,0.95)',
              }}>
                · on plan for conditions
              </span>
            ) : (
              <span style={{
                fontSize: 11, fontWeight: 700, marginLeft: 5,
                color: beat ? '#86efa0' /* --mint-readiness */ : '#F3AD38' /* --warn-text */,
              }}>
                · {delta > 0 ? `+${delta}` : delta} vs goal
              </span>
            )
          ) : null}
        </span>
      </div>
    </>
  );
}

/**
 * LONG+MP · "THE BUILD" panel · for long-run-with-MP-finish workouts
 * (e.g. 8 easy + 4 at marathon pace).
 *
 *   · AEROBIC BASE block · BlockHead + ribbon + meta · the easy build
 *   · MP SHIFT transition · last-easy → first-MP pace with signed gear
 *     change delta (green if drop ≥45s, amber if <30s)
 *   · MARATHON SHIFT block · BlockHead + meta + cmpBar (actual vs goal)
 *     + per-mile chips for the MP miles
 *   · Summary · MP BLOCK pace + delta vs goal
 *
 * Answers "did you nail the gear change?"
 */
function LongMpPanel({
  phases, splits,
}: {
  phases: NonNullable<RunSummary['phase_breakdown']>;
  splits: Array<{ mile: number; pace: string | null; elev_change_ft: number | null; hr?: number | null }>;
}) {
  const FONT_DISP = "var(--font-display, 'Oswald', sans-serif)";
  const ACCENT_MP = '#ff9f5a';

  // Aggregate the easy portion · everything before the work phase. Take the
  // first contiguous run of warmup/easy/cooldown-equivalent (treat all
  // non-work phases before the work phase as the base).
  const workIdx = phases.findIndex(p => p.type === 'work');
  if (workIdx === -1) return null;
  const work = phases[workIdx];
  const basePhases = phases.slice(0, workIdx);
  const baseDist = basePhases.reduce((sum, p) => sum + (p.actual_distance_mi ?? 0), 0);
  const baseDurSec = basePhases.reduce((sum, p) => sum + (p.actual_duration_sec ?? 0), 0);
  const basePaceSec = baseDist > 0 && baseDurSec > 0
    ? Math.round(baseDurSec / baseDist) : 0;
  const basePaceStr = basePaceSec > 0 ? fmtSecAsPace(basePaceSec) : null;
  const baseHrAvg = basePhases.length > 0
    ? (() => {
      const hrs = basePhases.map(p => p.avg_hr).filter((x): x is number => x != null && x > 0);
      return hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
    })()
    : null;

  // Transition · last easy mile pace vs first MP mile pace.
  const baseMileCount = Math.round(baseDist);
  const lastEasyMile = baseMileCount > 0 ? splits[baseMileCount - 1] : null;
  const firstMpMile = baseMileCount < splits.length ? splits[baseMileCount] : null;
  const lastEasyPace = lastEasyMile?.pace ?? null;
  const firstMpPace = firstMpMile?.pace ?? null;
  const shiftAvail = lastEasyPace && firstMpPace;
  const shiftDrop = shiftAvail
    ? paceToSec(lastEasyPace) - paceToSec(firstMpPace) : null;
  const shiftTone = shiftDrop == null ? '#86efa0' /* --mint-readiness */
    : shiftDrop >= 45 ? '#86efa0' /* --mint-readiness */
    : shiftDrop >= 30 ? '#86efa0' /* --mint-readiness */
    : '#F3AD38' /* --warn-text */;
  const shiftSign = (shiftDrop ?? 0) > 0 ? '−' : '+';
  const shiftMm = Math.floor(Math.abs(shiftDrop ?? 0) / 60);
  const shiftSs = Math.abs(shiftDrop ?? 0) % 60;

  // MP cmpBar · actual vs target.
  const mpActualSec = paceToSec(work.actual_pace ?? '');
  const mpTargetSec = paceToSec(work.target_pace ?? '');
  const mpDelta = mpActualSec > 0 && mpTargetSec > 0 ? mpActualSec - mpTargetSec : null;
  const mpBeat = mpDelta != null && mpDelta <= 0;
  const mpOnTarget = mpDelta === 0;
  const mpMaxdev = Math.max(8, Math.round((work.target_duration_sec ?? mpActualSec ?? 470) * 0.04));
  const mpFillW = mpDelta == null || mpOnTarget
    ? (mpOnTarget ? 6 : 0)
    : Math.max(5, Math.min(50, (Math.abs(mpDelta) / mpMaxdev) * 50));
  const mpFillLeft = mpOnTarget ? 47 : (mpDelta != null && mpDelta > 0 ? 50 - mpFillW : 50);

  // Per-mile chips · MP miles from splits aligned with the work phase.
  const mpMileChips: Array<{ label: string; pace: string; warn?: boolean }> = [];
  if (baseMileCount < splits.length && work.target_distance_mi != null) {
    const mpMiles = splits.slice(baseMileCount, baseMileCount + Math.round(work.target_distance_mi));
    mpMiles.forEach((s) => {
      const sec = paceToSec(s.pace ?? '');
      const warn = sec > 0 && mpTargetSec > 0 && sec > mpTargetSec + 10;
      if (s.pace) {
        mpMileChips.push({ label: `mi ${s.mile}`, pace: s.pace, warn });
      }
    });
  }

  return (
    <>
      {/* phead */}

      {/* Aerobic base block */}
      <div style={{ marginTop: 6 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
        }}>
          <span style={{
            fontFamily: FONT_DISP, fontSize: 14, fontWeight: 600,
            letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            AEROBIC BASE
            <em style={{
              fontStyle: 'normal', fontFamily: 'Inter, sans-serif',
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              opacity: 0.55, marginLeft: 7,
            }}>{Math.round(baseDist)} MI</em>
          </span>
          <span style={{
            fontFamily: FONT_DISP, fontSize: 19, fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            {basePaceStr ?? '·'}
            <small style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, opacity: 0.6, fontWeight: 500 }}>/mi</small>
          </span>
        </div>
        {/* Ribbon · accent gradient. */}
        <div style={{
          height: 11, borderRadius: 6, marginTop: 9,
          background: `linear-gradient(90deg, ${ACCENT_MP}, color-mix(in oklab, ${ACCENT_MP}, #fff 22%))`,
          opacity: 0.92,
        }} />
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.6)',
          marginTop: 5, whiteSpace: 'nowrap', gap: 10,
        }}>
          <span>Held easy through the build.</span>
          {baseHrAvg != null ? <span>{baseHrAvg} bpm</span> : <span>·</span>}
        </div>
      </div>

      {/* MP SHIFT transition */}
      {shiftAvail && shiftDrop != null ? (
        <div style={{ textAlign: 'center', margin: '8px 0 4px' }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 9, fontWeight: 800, letterSpacing: 1.6, color: ACCENT_MP,
          }}>↓ MP SHIFT</span>
          <div style={{
            fontSize: 11.5, fontWeight: 600,
            color: 'rgba(255,255,255,.7)', marginTop: 6,
          }}>
            Last easy <b style={{ fontFamily: FONT_DISP, color: '#fff', fontWeight: 600 }}>{lastEasyPace}</b>
            {' → '}first MP <b style={{ fontFamily: FONT_DISP, color: '#fff', fontWeight: 600 }}>{firstMpPace}</b>
          </div>
          <div style={{
            fontFamily: FONT_DISP, fontSize: 14, fontWeight: 600,
            marginTop: 4, color: shiftTone,
          }}>
            {shiftSign}{shiftMm}:{String(shiftSs).padStart(2, '0')} gear change
          </div>
        </div>
      ) : null}

      {/* Marathon shift block */}
      <div style={{ marginTop: 18 }}>
        <div style={{
          display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
        }}>
          <span style={{
            fontFamily: FONT_DISP, fontSize: 14, fontWeight: 600,
            letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            MARATHON SHIFT
            {work.target_distance_mi != null ? (
              <em style={{
                fontStyle: 'normal', fontFamily: 'Inter, sans-serif',
                fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                opacity: 0.55, marginLeft: 7,
              }}>{Math.round(work.target_distance_mi)} MI</em>
            ) : null}
          </span>
          <span style={{
            fontFamily: FONT_DISP, fontSize: 19, fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            {work.actual_pace ?? '·'}
            <small style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, opacity: 0.6, fontWeight: 500 }}>/mi</small>
          </span>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,.6)',
          marginTop: 5, whiteSpace: 'nowrap', gap: 10,
        }}>
          <span>{work.target_pace ? `TARGET ${work.target_pace}/mi` : 'TARGET ·'}</span>
          {work.avg_hr != null ? <span>{work.avg_hr} bpm</span> : <span>·</span>}
        </div>
        {/* MP cmpBar */}
        <div style={{
          position: 'relative', height: 12, borderRadius: 6,
          background: 'rgba(255,255,255,.1)', marginTop: 10,
        }}>
          {mpFillW > 0 && (
            <div style={{
              position: 'absolute', top: 1, bottom: 1,
              left: `${mpFillLeft}%`, width: `${mpFillW}%`,
              background: mpBeat ? '#86efa0' /* --mint-readiness */ : '#F3AD38' /* --warn-text */,
              borderRadius: 3,
            }} />
          )}
          <div style={{
            position: 'absolute', left: '50%', top: -2, bottom: -2, width: 2,
            marginLeft: -1, background: 'rgba(255,255,255,.92)', borderRadius: 1, zIndex: 3,
            boxShadow: '0 0 0 1px rgba(0,0,0,.2)',
          }} />
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontSize: 8, fontWeight: 700, letterSpacing: 1.1, marginTop: 6,
        }}>
          <span style={{ color: '#F3AD38' /* --warn-text */, opacity: 0.85 }}>◂ SLOWER</span>
          <span style={{ color: 'rgba(255,255,255,.45)' }}>TARGET</span>
          <span style={{ color: '#86efa0' /* --mint-readiness */, opacity: 0.9 }}>FASTER ▸</span>
        </div>

        {/* Per-mile chips */}
        {mpMileChips.length > 0 ? (
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 11,
          }}>
            {mpMileChips.map((chip, i) => (
              <span key={i} style={{
                fontSize: 9.5, fontWeight: 600, color: 'rgba(255,255,255,.55)',
                background: 'rgba(255,255,255,.05)',
                border: '1px solid rgba(255,255,255,.08)',
                borderRadius: 7, padding: '4px 7px',
              }}>
                {chip.label}
                <b style={{
                  fontFamily: FONT_DISP, fontWeight: 600,
                  color: chip.warn ? '#F3AD38' /* --warn-text */ : '#fff', marginLeft: 3,
                }}>{chip.pace}</b>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* Summary · MP BLOCK pace · vs goal */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 10, marginTop: 14, paddingTop: 14,
        borderTop: '1px solid rgba(255,255,255,.1)',
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'rgba(255,255,255,.55)',
        }}>MP BLOCK</span>
        <span style={{
          fontFamily: FONT_DISP, fontSize: 16, fontWeight: 600, textAlign: 'right',
        }}>
          {work.actual_pace ?? '·'}
          <small style={{
            fontFamily: 'Inter, sans-serif', fontSize: 10, fontWeight: 500, opacity: 0.6,
          }}>/mi</small>
          {mpDelta != null ? (
            <span style={{
              fontSize: 11, fontWeight: 700, marginLeft: 5,
              color: mpBeat ? '#86efa0' /* --mint-readiness */ : '#F3AD38' /* --warn-text */,
            }}>
              · {mpDelta > 0 ? `+${mpDelta}` : mpDelta} vs goal
            </span>
          ) : null}
        </span>
      </div>
    </>
  );
}

function fmtSecAsPace(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '·';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtMmSs(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return '·';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

type DayForecast = {
  date: string;
  temp_min_f: number | null;
  temp_max_f: number | null;
  conditions: string | null;
  precip_chance_pct: number | null;
  wind_mph: number | null;
  /** 2026-06-01 · server-composed pre-rendered strings · added for
   *  iPhone parity. Optional on the client type so older cached
   *  responses without these fields still parse. */
  range_label?: string | null;
  best_window?: string;
};

/** Lazy-fetch the day's forecast for a planned (not done) date. Used to
 *  replace the old KIT[d.type].weather hardcoded "64° · Calm" placeholder
 *  with a real temp range + conditions. Past days surface actual Strava
 *  weather via the run-detail fetch. */
function useDayForecast(dateIso: string | null | undefined): DayForecast | null {
  const [data, setData] = useState<DayForecast | null>(null);
  useEffect(() => {
    if (!dateIso) { setData(null); return; }
    let cancelled = false;
    fetch(`/api/forecast/${dateIso}`)
      .then(r => r.ok ? r.json() : null)
      .then((j: DayForecast | null) => { if (!cancelled && j) setData(j); })
      .catch(() => { /* swallow — card hides if no forecast */ });
    return () => { cancelled = true; };
  }, [dateIso]);
  return data;
}

/** "62-78° · Cloudy" / "78°" / null when no temp data. Prefers the
 *  server-composed `range_label` (added 2026-06-01 for iPhone parity)
 *  when present, falls back to the legacy client derivation for older
 *  cached forecasts. */
/**
 * Post-run WEATHER chip render · mirrors RunDetailModal's renderTempRange.
 *   · start + end differ ≥3°F → "65°F → 77°F" (the arc · what the runner
 *     fought through from gun to finish)
 *   · span enriched but small swing → peak (honest "what you ran in")
 *   · legacy single-point → temp_f
 *   · nothing → "·"
 */
function formatWeatherChip(
  tempF: number | null,
  range: RunSummary['temp_range_f'],
): string {
  if (range && range.start != null && range.end != null && Math.abs(range.end - range.start) >= 3) {
    return `${Math.round(range.start)}°F → ${Math.round(range.end)}°F`;
  }
  if (range && range.peak != null) return `${Math.round(range.peak)}°F`;
  if (tempF != null) return `${Math.round(tempF)}°F`;
  return '·';
}

function formatForecast(f: DayForecast | null): string | null {
  if (!f) return null;
  if (f.range_label !== undefined) return f.range_label;
  // Legacy fallback · matches the server's composeRangeLabel for older
  // cached forecasts. Drop once 30-min cache cycles past 2026-06-01.
  const lo = f.temp_min_f != null ? Math.round(f.temp_min_f) : null;
  const hi = f.temp_max_f != null ? Math.round(f.temp_max_f) : null;
  const range = lo != null && hi != null && lo !== hi
    ? `${lo}-${hi}°`
    : (hi != null ? `${hi}°` : (lo != null ? `${lo}°` : null));
  if (!range) return null;
  const cond = f.conditions ? prettyCondition(f.conditions) : null;
  return cond ? `${range} · ${cond}` : range;
}
function prettyCondition(c: string): string {
  switch (c) {
    case 'clear':        return 'Clear';
    case 'mostly_clear': return 'Mostly clear';
    case 'cloudy':       return 'Cloudy';
    case 'fog':          return 'Fog';
    case 'rain':         return 'Rain';
    case 'snow':         return 'Snow';
    case 'rain_shower':  return 'Showers';
    case 'snow_shower':  return 'Snow showers';
    case 'thunderstorm': return 'Storm';
    default:             return c;
  }
}

/**
 * 2026-06-03 · RestDayCard · enriched rest-day surface per David's
 * call: "Rest isn't just nothing, rest is your body recovering."
 *
 * Sections:
 *   · LET THE LOAD LAND · why today matters (week recap as context)
 *   · THIS WEEK · concrete numbers (mi done, days run, hard sessions)
 *   · TOMORROW · preview of the next planned workout · gives the
 *     rest day a visible purpose
 *   · RECOVERY · specific, actionable items · not generic platitudes
 *
 * Informational only · no "you should do this" prescriptive copy
 * per the no-reactive-coach doctrine (memory/feedback_no_reactive_coach.md).
 */
function RestDayCard({ d, seed }: { d: FaffSeed['week'][number]; seed?: FaffSeed }) {
  // Derive this week's recap from the week array.
  let weekMiles = 0;
  let daysRun = 0;
  let hardSessions = 0;
  const tomorrow: { type: string; dist: string; pace: string | null; name: string } | null = (() => {
    if (!seed) return null;
    const todayIdx = seed.week.findIndex(w => w.iso === d.iso);
    if (todayIdx < 0) return null;
    const nextIdx = todayIdx + 1;
    if (nextIdx >= seed.week.length) return null;
    const next = seed.week[nextIdx];
    return next ? {
      type: next.type,
      dist: next.dist || '',
      pace: next.pace || null,
      name: next.name || next.type.toUpperCase(),
    } : null;
  })();
  if (seed) {
    for (const w of seed.week) {
      if (w.done) {
        daysRun++;
        weekMiles += parseFloat(w.dist || '0') || 0;
        if (w.type === 'intervals' || w.type === 'tempo' || w.type === 'long') {
          hardSessions++;
        }
      }
    }
  }
  weekMiles = Math.round(weekMiles * 10) / 10;

  return (
    <div className="wcard" style={{ display: 'grid', gap: 16 }}>
      <div>
        <div className="wcl">REST</div>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 28, fontWeight: 600, lineHeight: 1, marginTop: 4 }}>
          Let the load land.
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.5, opacity: 0.86, marginTop: 12 }}>
          Recovery is when the body actually adapts to the work · sleep, hydrate, mobilize, and let yesterday's run consolidate.
        </div>
      </div>

      {/* THIS WEEK recap · real numbers from the week array. */}
      {seed ? (
        <div style={{
          padding: '12px 14px', borderRadius: 10,
          background: 'rgba(255,255,255,.04)',
          border: '1px solid rgba(255,255,255,.08)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, opacity: 0.55, marginBottom: 6 }}>
            THIS WEEK
          </div>
          <div style={{ display: 'flex', gap: 24, fontFamily: 'Oswald, sans-serif' }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{weekMiles}<small style={{ fontSize: 12, opacity: 0.7 }}> mi</small></div>
              <div style={{ fontSize: 10, opacity: 0.55, marginTop: 4, fontFamily: 'inherit' }}>done</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{daysRun}<small style={{ fontSize: 12, opacity: 0.7 }}> days</small></div>
              <div style={{ fontSize: 10, opacity: 0.55, marginTop: 4, fontFamily: 'inherit' }}>run</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1 }}>{hardSessions}</div>
              <div style={{ fontSize: 10, opacity: 0.55, marginTop: 4, fontFamily: 'inherit' }}>quality sessions</div>
            </div>
          </div>
        </div>
      ) : null}

      {/* TOMORROW preview · gives the rest day a visible target. */}
      {tomorrow && tomorrow.type !== 'rest' ? (
        <div style={{
          padding: '12px 14px', borderRadius: 10,
          background: 'rgba(255,255,255,.04)',
          border: '1px solid rgba(255,255,255,.08)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, opacity: 0.55, marginBottom: 6 }}>
            TOMORROW
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <div style={{
              fontFamily: 'Oswald, sans-serif', fontSize: 20, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: 0.4,
            }}>
              {tomorrow.name.toUpperCase()}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {tomorrow.dist} mi{tomorrow.pace ? ` · ${tomorrow.pace}/mi` : ''}
            </div>
          </div>
        </div>
      ) : null}

      {/* Recovery targets · specific, not platitudes. */}
      <div className="kit">
        <div className="kc"><div className="kcl">SLEEP TARGET</div><div className="kcv">8h tonight</div></div>
        <div className="kc"><div className="kcl">MOBILITY</div><div className="kcv">15 min · hips, calves</div></div>
        <div className="kc"><div className="kcl">FUEL</div><div className="kcv">{tomorrow?.type === 'long' ? 'Carb-forward · top up' : 'Balanced + hydrate'}</div></div>
      </div>
    </div>
  );
}

function WorkoutCard({ d, done, result, runData, runLoading, shoes, seedShoe, persistShoe, seed }: { d: FaffSeed['week'][number]; done: boolean; result?: FaffSeed['results'][number]; runData: RunSummary | null; runLoading: boolean; shoes: FaffSeed['shoes']; seedShoe: string | null; persistShoe: boolean; seed?: FaffSeed }) {
  if (done) {
    return <CompletedResultCard d={d} fallback={result} runData={runData} loading={runLoading} />;
  }
  // Rest day gets a recovery-focused panel · enriched 2026-06-03 per
  // David: "Rest isn't just nothing, rest is your body recovering."
  // Adds THIS WEEK recap (real volume + days run) and TOMORROW preview
  // (so the rest day has visible purpose). Informational only · no
  // prescriptive copy ("eat this," "sleep more") per the no-reactive-
  // coach doctrine.
  if (d.type === 'rest') {
    return <RestDayCard d={d} seed={seed} />;
  }
  // 2026-06-02 · spec-driven session shape (was SEGS prototype data)
  const totalMi = parseFloat(d.dist || '0') || 0;
  const sg = deriveSessionSegs(d.workoutSpec ?? null, totalMi, d.type, d.pace)
    ?? fallbackSessionSegs(d.type, totalMi, d.pace)
    ?? [];
  const k = KIT[d.type];
  // 2026-05-30: real forecast for the day of the run replaces the
  // hardcoded "64° · Calm" placeholder. Shows a temp range (no run-time
  // pinned yet, so range is honest), conditions when present. Falls
  // through to "—" when no forecast is available (date out of range, or
  // no home GPS yet) — better than fake weather.
  const forecast = useDayForecast(d.iso);
  const weatherLabel = formatForecast(forecast) ?? '—';
  return (
    <div className="wcard">
      <div className="wcl">WORKOUT</div>
      <div className="shape">
        {sg.map((x, i) => <i key={i} style={{ width: `${x.w}%`, background: x.c }} />)}
      </div>
      <div className="segs">
        {sg.map((x, i) => (
          <div className="seg" key={i}>
            <span className="sd" style={{ background: x.c }} />
            <span className="sl">{x.l}</span>
            <span className="ss">{x.sub}</span>
          </div>
        ))}
      </div>
      <div className="kit">
        <div className="kc"><div className="kcl">WEATHER</div><div className="kcv">{weatherLabel}</div></div>
        <div className="kc">
          <div className="kcl">SHOE</div>
          <ShoePicker shoes={shoes} initial={seedShoe} persist={persistShoe} />
        </div>
        <div className="kc"><div className="kcl">FUEL</div><div className="kcv">{k.fuel}</div></div>
      </div>
      <div className="wcoach"><span className="ct">COACH</span>{k.coach}</div>
    </div>
  );
}

function ShoePicker({ shoes, initial, persist, runId }: { shoes: FaffSeed['shoes']; initial: string | null; persist: boolean; runId?: string | null }) {
  // 2026-05-31: `picked` must stay in sync with `initial` after a fresh SSR
  // render. Previously the useState seed froze on the first mount value, so
  // when the parent re-rendered with the just-persisted shoe (after
  // router.refresh or a navigation back), the picker still showed the
  // pre-persist initial. Sync `picked` whenever `initial` changes (e.g. on
  // a fresh seed load) so the persisted choice survives a reload.
  const [picked, setPicked] = useState(initial);
  useEffect(() => { setPicked(initial); }, [initial]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  // 2026-05-30: dropdown menu rendered via React Portal to document.body.
  // The parent .wcard / .tile both have backdrop-filter, which establishes
  // a CSS stacking context — z-index on the menu can't escape it (David's
  // screenshot: dropdown rendered behind Training Form tile). Portaling
  // gets the menu out of the stacking hierarchy entirely.
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; minWidth: number }>({ top: 0, left: 0, minWidth: 220 });

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    function place() {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({
        top: r.bottom + window.scrollY + 6,
        left: r.left + window.scrollX,
        minWidth: Math.max(220, r.width),
      });
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function commit(s: FaffSeed['shoes'][number]) {
    setPicked(s.nm);
    setOpen(false);
    // 2026-05-31: completed-run picker routes to PATCH /api/runs/[id] so the
    // shoe persists onto strava_activities.shoe_id directly · the load
    // path on the done hero reads `runData.shoe_id` for the displayed
    // shoe (see resolvedShoeNm), and that field only updates when the
    // run row itself is patched. The old code POSTed to /api/today/shoe
    // (day_actions per-day override), which the done hero never reads
    // back, so the selection looked persisted but reverted on reload.
    //
    // Planned today (no runId): keep the day_actions path · that's what
    // seed.todayShoeId reads on first paint of a planned workout.
    if (runId) {
      setSaving(true);
      try {
        await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ shoe_id: Number(s.id) }),
        });
      } catch { /* swallow · UI stays optimistic */ }
      finally { setSaving(false); }
      return;
    }
    if (!persist) return;
    setSaving(true);
    try {
      await fetch('/api/today/shoe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shoe_id: String(s.id) }),
      });
    } catch { /* swallow · UI is optimistic */ }
    finally { setSaving(false); }
  }

  if (!shoes.length) {
    // No garage yet (new runner) · honest blank, not a phantom shoe.
    return <div className="kcv">{picked?.trim() ? picked : '—'}</div>;
  }

  const menu = open && mounted ? createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'absolute', zIndex: 9999,
        top: pos.top, left: pos.left, minWidth: pos.minWidth,
        background: '#171922', border: '1px solid rgba(255,255,255,.16)',
        borderRadius: 13, padding: 6, boxShadow: '0 22px 54px -20px rgba(0,0,0,.85)',
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, opacity: 0.5, padding: '6px 10px 8px' }}>WORN ON THIS RUN</div>
      {shoes.map(s => (
        <div
          key={s.nm}
          onClick={() => { void commit(s); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '9px 10px', borderRadius: 9, cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: '#F6F7F8',
            background: s.nm === picked ? 'rgba(255,206,138,.12)' : undefined,
          }}
        >
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: ROLECOL[s.role] ?? '#14C08C' }} />
          {s.nm}
          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, opacity: 0.5 }}>{s.role}</span>
        </div>
      ))}
    </div>,
    document.body
  ) : null;

  // 2026-06-04 · David's QC: empty SHOE chip rendered as bare dots (the
  // .kcv style + an empty `picked` string). Show an explicit "TAP TO
  // LINK" affordance when no shoe is selected so the absence reads as
  // an action prompt, not a layout glitch.
  const hasPicked = !!(picked && picked.trim());
  return (
    <div ref={triggerRef} style={{ display: 'inline-block' }}>
      <div
        className="kcv"
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          opacity: saving ? 0.7 : 1,
          ...(hasPicked ? {} : {
            color: 'rgba(246,247,248,0.42)',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.4,
          }),
        }}
        onClick={() => setOpen(o => !o)}
        role="button"
        tabIndex={0}
      >
        {hasPicked ? picked : 'TAP TO LINK'}
        <span style={{ fontSize: 9, opacity: 0.55 }}>▾</span>
      </div>
      {menu}
    </div>
  );
}

/* ─────────────── RaceDayHero · race-morning takeover ───────────────
 * 2026-06-08 · The brief is categorical: "Race day. The race takes the
 * page." / "Race day morning is reverent." Before this, web Today had no
 * race composition — mapType laundered type=race → 'easy' and the morning
 * rendered a cyan EASY hero. This renders ONLY on race morning (gated in
 * TodayView: goalRace.daysAway===0 AND the selected day is the race date
 * AND the race isn't logged yet).
 *
 * Surface = the one sanctioned filled-accent surface (design brief §Surface):
 * the race-orange gradient (160deg #FF8A3D → #D03F3F → #E03E00). Countdown
 * collapses to TODAY. Goal time + goal pace + B-goal (the canonical A+7:00
 * derivation, matching raceDetail.ts). Projection vs goal. Logistics,
 * pacing splits, fueling and course stay one tap away via "Full race plan"
 * → onOpenRace (RaceView), which already owns that depth. */
/** 2026-06-09 · race-killer F2 — delegate to the shared parser. The local
 *  2-part branch read "1:30" (the stored AFC goalDisplay) as 90 seconds, so
 *  the first-ever race-morning render would have shown goal pace "0:07/mi"
 *  and B·SAFE "8:30". parseRaceTime carries the H:MM-vs-MM:SS heuristic
 *  fixed in lib on 2026-06-03 (vdot.ts:145) — race-day surfaces never got it. */
function parseHMSToSec(s: string | null | undefined): number | null {
  return parseRaceTime(s);
}
function fmtHMS(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
}
function fmtMMSS(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function RaceDayHero({
  goal, onOpenRace,
}: {
  goal: NonNullable<FaffSeed['goalRace']>;
  onOpenRace: () => void;
}) {
  const goalSec = parseHMSToSec(goal.goal);
  const goalPace = goalSec && goal.distanceMi ? fmtMMSS(goalSec / goal.distanceMi) : null;
  // Canonical B-goal · A + 7:00, the same +420s derivation raceDetail.ts
  // uses for the RaceView B·SAFE row. Derived, never stored.
  const bGoal = goalSec ? fmtHMS(goalSec + 420) : null;
  const showProjection = !!goal.projected && goal.projected !== goal.goal;
  const eyebrow = goal.location ? `RACE DAY · ${goal.location.toUpperCase()}` : 'RACE DAY';

  return (
    <div
      className="raceday-hero"
      style={{
        position: 'relative',
        borderRadius: 22,
        overflow: 'hidden',
        background: 'linear-gradient(160deg, #FF8A3D 0%, #D03F3F 55%, #E03E00 100%)',
        color: '#FFFFFF',
        padding: '34px 32px 30px',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.20)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', opacity: 0.82 }}>
        {eyebrow}
      </div>
      <div
        style={{
          fontFamily: 'Oswald, sans-serif',
          fontWeight: 700,
          // Fluid so the hero numeral never clips on narrow viewports
          // (the web command-center renders down to phone width).
          fontSize: 'clamp(64px, 17vw, 112px)',
          lineHeight: 0.9,
          letterSpacing: '-0.04em',
          marginTop: 8,
        }}
      >
        TODAY
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '0.01em', marginTop: 6, textTransform: 'uppercase' }}>
        {goal.name}
      </div>

      {/* Goal block · A goal + pace · B safe */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(18px, 6vw, 44px)', marginTop: 28 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', opacity: 0.8 }}>GOAL</div>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(34px, 9vw, 46px)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {goal.goal}
          </div>
          {goalPace ? (
            <div style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.88, marginTop: 4 }}>{goalPace}/mi</div>
          ) : null}
        </div>
        {bGoal ? (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', opacity: 0.8 }}>B · SAFE</div>
            <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 'clamp(34px, 9vw, 46px)', lineHeight: 1, fontVariantNumeric: 'tabular-nums', opacity: 0.9 }}>
              {bGoal}
            </div>
          </div>
        ) : null}
      </div>

      {showProjection ? (
        <div style={{ fontSize: 13, fontWeight: 600, marginTop: 22, opacity: 0.92 }}>
          Fitness reads {goal.projected}{goal.delta ? ` · ${goal.delta}` : ''}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onOpenRace}
        style={{
          marginTop: 26,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          background: 'rgba(255,255,255,.16)',
          color: '#FFFFFF',
          border: '1px solid rgba(255,255,255,.30)',
          borderRadius: 12,
          padding: '11px 18px',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.02em',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Full race plan
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}

/** Time-goal GAP body · 2026-06-10 (David: "they could just want to hit
 *  a time and then let the plan tell them when its possible"). Renders
 *  the goal-ready projection for TT-goal runners with no goal race —
 *  one branch per honesty state, never a fabricated date. Method +
 *  citations live in lib/training/goal-ready.ts (Daniels reassessment
 *  quantum caps the rate; freshness window bounds the trend). */
function GoalReadyBody({ ready }: { ready: NonNullable<FaffSeed['goalReady']> }) {
  const fmtMon = (iso: string) => {
    const d = new Date(iso + 'T12:00:00Z');
    const thisYear = new Date().getUTCFullYear();
    return d.toLocaleDateString('en-US', d.getUTCFullYear() === thisYear
      ? { month: 'short' } : { month: 'short', year: 'numeric' });
  };
  const goalTime = formatRaceTime(ready.goalTimeSec) ?? '—';
  const pct = ready.currentVdot != null
    ? Math.max(0, Math.min(100, Math.round((ready.currentVdot / ready.requiredVdot) * 100)))
    : 0;

  const byState: Record<typeof ready.state, { big: string; color: string; lab: string; sub: string; foot: string; footColor: string }> = {
    'in-range': {
      big: goalTime, color: '#3EBD41', lab: 'IN RANGE NOW',
      sub: `Fitness is there · VDOT ${ready.currentVdot} vs ${ready.requiredVdot} needed`,
      foot: 'Trend says race it — book one', footColor: '#3EBD41',
    },
    'projectable': {
      big: `~${fmtMon(ready.readyEarliestISO!)}`, color: '#F3AD38', lab: 'IN RANGE BY',
      sub: `Goal ${goalTime} · window ${fmtMon(ready.readyEarliestISO!)}–${fmtMon(ready.readyLatestISO!)}`,
      foot: `On your trend · +${ready.observedPerWeek} VDOT/wk`, footColor: '#F3AD38',
    },
    'trend-flat': {
      big: goalTime, color: '#9099A8', lab: 'GOAL',
      sub: 'Trend is not moving toward it yet',
      foot: 'Keep stacking weeks', footColor: '#9099A8',
    },
    'beyond-horizon': {
      big: goalTime, color: '#9099A8', lab: 'GOAL',
      sub: 'More than a year out on current trend',
      foot: 'Long game · keep building', footColor: '#9099A8',
    },
    'insufficient-data': {
      big: goalTime, color: '#9099A8', lab: 'GOAL',
      sub: 'A few more weeks of running to project',
      foot: 'Building the trend', footColor: '#9099A8',
    },
  };
  const s = byState[ready.state];

  return (
    <div className="tbody cd">
      <div className="cdbig" style={{ color: s.color }}>{s.big}</div>
      <div className="cdlab">{s.lab}</div>
      <div className="cdsub" style={{ opacity: 0.8 }}>{s.sub}</div>
      <div className="cdbar"><div className="cdfill" style={{ width: `${pct}%`, background: s.color }} /></div>
      <div className="cdwk" style={{ color: s.footColor, opacity: 1 }}>{s.foot}</div>
    </div>
  );
}

function Tiles({ seed, onOpenRace }: { seed: FaffSeed; onOpenRace: () => void }) {
  const goal = seed.goalRace;
  // AUDIT #34 · the THE GAP tile must read the SAME trajectory-derived status +
  // projected number the Targets gap panel shows, or the same runner can read
  // OFF TRACK (red) here and ON TRACK on Targets in one page load. The drift
  // ladder (goal.goalStatus / .projected / .onTrack / .delta) and the forward
  // trajectory are two independent engines (TargetsView.tsx documents the
  // hazard). Canonical = the trajectory; mirror TargetsView's derivation here
  // and fall back to the drift fields only when there's no trajectory.
  const goalTraj = goal?.trajectory ?? null;
  const goalStatusReconciled: 'on-track' | 'watching' | 'off-track' | undefined = goalTraj
    ? (goalTraj.reachable ? 'on-track' : goalTraj.gapVdot <= 1.5 ? 'watching' : 'off-track')
    : goal?.goalStatus;
  // Race-day projected finish = the trajectory hero number Targets renders
  // (traj.projectedSec). Falls back to the drift-ladder projected string.
  const goalProjected: string | undefined = goalTraj?.projectedSec != null
    ? (formatRaceTime(goalTraj.projectedSec) ?? goal?.projected)
    : goal?.projected;
  // Delta vs goal from the trajectory gap (positive gapSec = slower than goal =
  // behind), formatted like seed.ts's drift delta. Falls back to goal.delta.
  const goalDelta: string | undefined = (() => {
    if (goalTraj?.gapSec == null) return goal?.delta;
    const ahead = goalTraj.gapSec <= 0; // gapSec ≤ 0 means projected at/under goal
    const abs = Math.abs(goalTraj.gapSec);
    const mins = Math.floor(abs / 60);
    const secs = Math.round(abs % 60);
    const mag = mins > 0 ? `${mins} min` : `${secs} sec`;
    return `${mag} ${ahead ? 'ahead' : 'behind'}`;
  })();
  // On-track flag the tile's color/footer branches read, reconciled to the
  // trajectory status (so green/red here matches Targets' pill).
  const goalOnTrackReconciled: boolean =
    goalStatusReconciled != null ? goalStatusReconciled === 'on-track' : Boolean(goal?.onTrack);
  const ready = !goal ? seed.goalReady : null;
  const [hoverBar, setHoverBar] = useState<number | null>(null);
  const bar = hoverBar != null ? seed.volumeBars[hoverBar] : null;
  const num = bar ? `${bar.mi}` : `${seed.thisWeekMiles}`;
  const sub = bar ? ` mi · ${bar.label}` : ` mi · 8-wk avg ${seed.weeklyAvg}`;

  return (
    <div className="tiles">
      <div
        className={`tile${goal ? '' : ' click'}`}
        onClick={goal ? undefined : onOpenRace}
        role={goal ? undefined : 'button'}
        tabIndex={goal ? undefined : 0}
      >
        <div className="fll">THE GAP{goal
          ? ` · ${goal.name.toUpperCase().replace(' MARATHON','').slice(0,12)}`
          : ready ? ` · ${ready.goalLabel}` : ''}</div>
        {ready ? <GoalReadyBody ready={ready} /> : (
        <div className="tbody cd">
          {/* 2026-05-30: when projection hasn't computed (no recent race result
              yet → no VDOT seed), show the goal as the big number so the tile
              doesn't read as broken. Bottom row explains why.

              AFC fix 2 (2026-06-09) · off-track is the warn color #FC4D64,
              never race orange. The retired #FF8847 here made the brand's celebration
              hue double as the failure hue on the same page. On-track
              footer drops the out-of-palette mint for the good-state green.

              AFC fix 9 · the no-goal state is a real affordance now: the
              tile is clickable (routes to the Goal page) and the copy says
              what tapping does instead of quoting a URL path. */}
          {/* AUDIT #34 · status / projected / delta below are the reconciled,
              trajectory-derived values (goalStatusReconciled / goalProjected /
              goalDelta / goalOnTrackReconciled) so this tile agrees with Targets. */}
          <div className="cdbig" style={{
            color: !goal?.projected ? '#9099A8'
              : goalStatusReconciled === 'off-track' ? '#FC4D64'
              : goalStatusReconciled === 'watching' ? '#F3AD38'
              : goalOnTrackReconciled ? '#3EBD41'
              : '#FC4D64',
          }}>
            {goalProjected ?? goal?.goal ?? '—'}
          </div>
          <div className="cdlab">{goal?.projected ? 'PROJECTED FINISH' : (goal ? 'TARGET FINISH' : 'NO GOAL SET')}</div>
          {goal?.projected
            ? (goalStatusReconciled === 'watching'
                ? <div className="cdsub">Goal {goal.goal} · watching</div>
                : <div className="cdsub">Goal {goal.goal} · {goalDelta}</div>)
            : (goal ? <div className="cdsub" style={{ opacity: 0.7 }}>Log a recent race to project</div> : <div className="cdsub" style={{ opacity: 0.7 }}>Pick a goal race ›</div>)}
          <div className="cdbar"><div className="cdfill" style={{
            width: `${goal?.goalPct ?? 0}%`,
            background: goalStatusReconciled === 'off-track' ? '#FC4D64'
              : goalStatusReconciled === 'watching' ? '#F3AD38'
              : goalOnTrackReconciled ? '#3EBD41'
              : '#FC4D64',
          }} /></div>
          <div className="cdwk" style={{
            color: goalStatusReconciled === 'off-track' ? '#FC4D64'
              : goalStatusReconciled === 'watching' ? '#F3AD38'
              : goalOnTrackReconciled ? '#3EBD41'
              : '#F3AD38',
            opacity: 1,
          }}>
            {goal
              ? (goal.projected
                  ? (goalStatusReconciled === 'watching'
                      ? `Watching · ${goal.goal} still in play`
                      : goalOnTrackReconciled ? `On track for ${goal.goal}` : `${goalDelta}`)
                  : 'Projection pending')
              : 'No goal race set'}
          </div>
        </div>
        )}
      </div>

      <div className="tile click" onClick={onOpenRace} role="button" tabIndex={0}>
        <div className="fll">RACE DAY{goal ? ` · ${goal.name.toUpperCase().replace(' MARATHON','').slice(0,12)}` : ''}</div>
        <div className="tbody cd">
          <div className="cdbig">{goal?.daysAway ?? '—'}</div>
          <div className="cdlab">{goal ? 'DAYS TO GO' : 'NO GOAL SET'}</div>
          <div className="cdsub" style={{ opacity: goal ? 1 : 0.7 }}>
            {goal ? `${formatDate(goal.date)}${goal.location ? ' · ' + goal.location : ''}` : 'Pick a goal race ›'}
          </div>
          <div className="cdbar"><div className="cdfill" style={{ width: `${goal?.goalPct ?? 0}%` }} /></div>
          <div className="cdwk">{goal?.phaseLabel ?? (goal ? 'Building' : '—')}</div>
        </div>
      </div>

      <div className="tile">
        <div className="fll">WEEKLY VOLUME</div>
        <div className="tbody vfill">
          <div className="vol">
            {(() => {
              const maxMi = Math.max(...seed.volumeBars.map(x => x.mi), 1);
              return seed.volumeBars.map((b, i) => {
                const pct = b.mi > 0 ? (b.mi / maxMi) * 100 : 0;
                return (
                  <i
                    key={i}
                    onMouseEnter={() => setHoverBar(i)}
                    onMouseLeave={() => setHoverBar(null)}
                    style={{
                      height: b.mi > 0 ? `${pct}%` : '3px',
                      background: b.current ? '#FFFFFF' : 'rgba(255,255,255,.55)',
                    }}
                  />
                );
              });
            })()}
          </div>
          <div className="volnum">{num}<small>{sub}</small></div>
        </div>
      </div>

      {(() => {
        // 2026-06-01 · Training Form card · Banister TSB labels live
        // (backend commit 39a42b4b). Label-aware color + helper copy
        // per designs/briefs/training-form-banister-frontend-brief.md.
        // Ring fill now proportional to |delta| (clamped 0-50, the
        // typical band a year-round runner traverses) · was previously
        // a hardcoded 50% offset and ignored seed.form.delta entirely.
        // AFC fix 2 · every form state gets a DISTINCT in-palette color.
        // LOADED and DETRAINING previously shared the same amber even
        // though they demand opposite corrections (back off vs build up),
        // and color is this ring's only encoding since the text label was
        // dropped. DETRAINING → recovery blue per the locked table
        // ("Recovery #27B4E0 · detraining signal"). RACE-READY → PR gold
        // (primed is the milestone state, distinct from everyday good).
        const FORM_COLOR: Record<string, string> = {
          OVERREACH:    '#FC4D64',  // off/warn · sustained negative load
          LOADED:       '#F3AD38',  // amber · high stress but productive
          PRODUCTIVE:   '#3EBD41',  // good state · balanced
          'RACE-READY': '#F0DF47',  // gold · post-taper primed
          DETRAINING:   '#27B4E0',  // recovery blue · too fresh too long
          BUILDING:     '#8A90A0',  // neutral grey · cold-start
        };
        // Sentence-case after the middot separator per
        // designs/briefs/sentence-case-after-middot-brief.md. The
        // middot acts like a period · the clause after it starts
        // a new sentence and capitalizes.
        const FORM_HELPER: Record<string, string> = {
          OVERREACH:    'Acute load above your baseline. Pull back this week.',
          LOADED:       'Running hot · Productive but watch sleep + recovery.',
          PRODUCTIVE:   'Productive training · Fatigue and fitness balanced.',
          'RACE-READY': "Primed for a race. Don't add new load this week.",
          DETRAINING:   'Too fresh for too long · Fitness eroding. Build back up.',
          BUILDING:     'Building your baseline · More data coming.',
        };
        const formColor = FORM_COLOR[seed.form.label] ?? '#8A90A0';
        const formHelper = FORM_HELPER[seed.form.label] ?? null;
        const dashLen = 339.3;
        const absDelta = Math.min(50, Math.abs(seed.form.delta));
        const fillPct = absDelta / 50;
        const dashOffset = dashLen - dashLen * fillPct;
        return (
          <div className="tile">
            <div className="fll">TRAINING FORM</div>
            <div className="tbody">
              {/* 2026-06-01 · LOADED text label dropped per
                  designs/briefs/training-form-drop-label-brief.md.
                  The ring color encodes the band visually + the
                  helper line below carries the meaning in plain
                  English. State name still ships via aria-label so
                  screen readers get it · backend keeps the label
                  for other surfaces (Health view, drill-down). */}
              <div className="rg" style={{ width: 124, height: 124 }} role="img" aria-label={`Training form: ${seed.form.label}, ${seed.form.delta >= 0 ? 'plus' : 'minus'} ${Math.abs(Math.round(seed.form.delta))}`}>
                <svg width="124" height="124" viewBox="0 0 124 124">
                  <circle cx="62" cy="62" r="54" fill="none" stroke="rgba(255,255,255,.16)" strokeWidth="7"/>
                  <circle cx="62" cy="62" r="54" fill="none" stroke={formColor} strokeWidth="7" strokeLinecap="round" strokeDasharray={dashLen} strokeDashoffset={dashOffset} transform="rotate(-90 62 62)"/>
                </svg>
                <div className="rgc">
                  <b style={{ fontSize: 32, color: formColor }}>{seed.form.delta >= 0 ? '+' : '−'}{Math.abs(Math.round(seed.form.delta))}</b>
                </div>
              </div>
              <div className="formsub">Fitness {seed.form.fitness} · Fatigue {seed.form.fatigue}</div>
              {formHelper ? <div className="formhelper">{formHelper}</div> : null}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function formatSleep(hours: number | undefined): React.ReactNode {
  if (!hours || hours <= 0) return <>·</>;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return <>{h}:{String(m).padStart(2, '0')}<small> hrs</small></>;
}
function formatDate(iso: string): string {
  // noon-UTC anchor on the date part so the label never shifts a day by timezone.
  const d = new Date(iso.slice(0, 10) + 'T12:00:00Z');
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
}
