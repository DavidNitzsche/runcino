'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import type { FaffSeed } from '../types';
import { EFF, KIT, ROLECOL } from '../constants';
import { buildAdaptText } from '../adapt-text';
import { workoutTypeTitle } from '@/lib/coach/workout-title';
import { deriveSessionSegs, fallbackSessionSegs, deriveBlueprintData, type BlueprintData, type BlueprintSegment } from '../session-shape';
import { elevPathFromSplits } from '@/lib/route/polyline';
import { CoachProposalCard } from '../cards/CoachProposalCard';
import { PlanProposalCard } from '../cards/PlanProposalCard';
import { RouteMap } from '../RouteMap';
import {
  AdaptationCard,
  DayStatePill,
  ProfileGapCard,
  ReconnectBanner,
} from '../toolkit';

export function TodayView({
  seed, curDay, onPickDay, onOpenDrawer, onOpenRace,
}: {
  seed: FaffSeed; curDay: number;
  onPickDay: (i: number) => void;
  onOpenDrawer: () => void;
  onOpenRace: () => void;
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
  const isSkipped = (day: typeof seed.week[number]) =>
    (day.iso && day.iso in skipOverrides) ? skipOverrides[day.iso!] : !!day.skipped;
  const setSkippedFor = (iso: string | undefined, next: boolean) => {
    if (!iso) return;
    setSkipOverrides((m) => ({ ...m, [iso]: next }));
  };

  const d = seed.week[curDay] ?? seed.week[seed.todayIdx];
  const e = EFF[d.type];
  const isRest = d.type === 'rest';
  const dSkipped = isSkipped(d);
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
      {/* Reconnect banner · auto-hides when Strava is connected. Closes
          coverage row 1602 (connections-skipped) when the banner reads
          the strava status as `disconnected`. */}
      <div style={{ marginBottom: 12 }}>
        <ReconnectBanner />
      </div>

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
          const ringColor =
            band === 'sharp' ? '#34D058' :
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
                <div className="rv">{score}</div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Adaptation card row. The ACWR load chip used to ride here; it was
          removed 2026-06-01 and will live inside readiness once that
          backend lands. */}
      <div style={{ marginTop: 10 }}>
        <AdaptationCard />
      </div>

      {/* Physiology auto-nudge · only after 3+ days post-onboarding
          with no physiology data + no AppleHealth. Closes coverage row
          1647 (T2 physiology onboarding signals step) via the
          "auto-surface a Today nudge" branch (David decision 2026-05-31). */}
      {showPhysiologyNudge ? (
        <div style={{ marginTop: 12 }}>
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
        </div>
      ) : null}

      {/* Missed yesterday pill · three options when last planned day
          went unrun + unskipped. Closes coverage line 441. */}
      {missedYesterday ? (
        <div style={{ marginTop: 12 }}>
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
        </div>
      ) : null}

      {/* Card stack · order locked 2026-06-01 (David default):
          runner-actionable first, then auto-applied notifications.
            1. seed.pendingProposals · coach_proposals (illness/injury)
            2. seed.planProposals where status='pending' · drift cards
            3. seed.planProposals where status='auto_applied' · race-edit
               rebuild notifications
          The loader (lib/plan/proposals-state.ts) returns 0-5 items
          total and filters accepted/dismissed/superseded. */}
      {seed.pendingProposals.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          {seed.pendingProposals.map((p) => (
            <CoachProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      ) : null}

      {seed.planProposals && seed.planProposals.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          {seed.planProposals
            .filter((p) => p.status === 'pending')
            .map((p) => <PlanProposalCard key={`pp-${p.id}`} proposal={p} />)}
          {seed.planProposals
            .filter((p) => p.status === 'auto_applied')
            .map((p) => <PlanProposalCard key={`pp-${p.id}`} proposal={p} />)}
        </div>
      ) : null}

      {/* Morning brief content moved 2026-06-01 into the redesigned
          Readiness drawer (overlays/Drawer.tsx). The inline panel that
          rendered the same data on Today is removed · same data now
          surfaces in one place when the runner taps the readiness ring.
          See designs/from Design agent/readiness-drawer/. */}

      <div className="weeklab">THIS WEEK</div>
      {/* 2026-06-01 · This Week strip · Direction A redesign per
          designs/from Design agent/week-strip/README.md. Fixed-height
          card (152px) with reserved 16px meta row at the bottom so
          annotations (adapted "was X", strength glyph, done glyph)
          never make a card taller than its neighbors. The strength
          row is demoted from a separate text line to a top-right
          dumbbell glyph in the icon cluster. Adaptation line lives
          in the bottom meta row · only renders when original label
          actually differs from current (no-op suppression per spec). */}
      <div className="week wkstrip-v2">
        {seed.week.map((day, i) => {
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
          const showStrength = !!day.strengthSuggested && !skipped;
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
                        {/* 2026-06-03 · done state when HK / manual session
                            matched this date. Dumbbell + check overlay. */}
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/>
                          <circle cx="18" cy="18" r="5" fill="#34C194" stroke="none"/>
                          <path d="M16 18l1.5 1.5L20 17" stroke="#fff" strokeWidth="2.2"/>
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
                    <svg viewBox="0 0 24 24" fill="none" stroke="#ffce8a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="wc-was-icn">
                      <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>
                    </svg>
                    <span className="wc-was-tx">{wasText}</span>
                  </>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {/* Strength-recommender reason banner removed 2026-06-01 (David
          call · "why are we making a banner for strength at all"). The
          chip-level "+ STRENGTH" annotation is the single surface;
          the dormant-runner coach intent flows through the existing
          /api/coach/intents stream (CoachActivityTimeline). The full
          recommendation envelope still rides on the seed and is
          available to other consumers · just no longer surfaces as
          standalone chrome on Today. */}

      {/* 2026-06-01 · weekly strength status chip · backend brief
          `strength-hk-web-consumer-brief.md`. Renders
          `glance.strengthWeekStatus.summary` directly · zero chrome,
          single line below the week strip. Silent when summary is
          empty or no days were recommended (race weeks). This is a
          reconciliation read-out, not a marketing nudge · "2/2 this
          week + 1 bonus" / "1/2 · 1 skipped" — pure status. */}
      {seed.strengthWeekStatus?.summary && seed.strengthWeekStatus.recommended.length > 0 ? (
        <div className="strstatus">
          <span className="strstatus-icn" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11"/>
            </svg>
          </span>
          <span className="strstatus-tx">{seed.strengthWeekStatus.summary}</span>
        </div>
      ) : null}

      {/* 2026-05-31: hero v2 — done days use CompletedHeroV2 (Post-Run
          Detail (Easy)), planned-and-not-rest days use PlannedHeroV2
          (Run Detail Planned (Easy)). Rest days keep the simple Recovery
          panel below for now. */}
      {d.done && !isRest ? (
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
            : null) ?? seed.shoeRecByType[d.type] ?? KIT[d.type].shoe}
          persistShoe={curDay === seed.todayIdx}
        />
      ) : !isRest ? (
        <>
          <PlannedHeroV2
            d={d}
            shoes={seed.shoes}
            seedShoe={(seed.todayShoeId != null
              ? seed.shoes.find(s => s.id === seed.todayShoeId)?.nm
              : null) ?? seed.shoeRecByType[d.type] ?? KIT[d.type].shoe}
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
          <StandingRecAdvisory
            rec={d.standingRecommendation}
            workoutId={d.planWorkoutId ?? null}
            hidden={dSkipped}
            onAccepted={() => router.refresh()}
          />
        </>
      ) : (
        <div className="hero">
          <div className="hmain">
            <div className="htag">
              {(d.today ? 'TODAY · ' : `${d.dw} · `) + d.type.toUpperCase()}
            </div>
            <div className="htitle">{workoutTypeTitle(d.type)}</div>
            <div className="stats">
              <div><div className="v">{formatSleep(seed.health.body.find(m => m.k === 'sleep')?.current)}</div><div className="k">SLEEP</div></div>
              <div><div className="v">{Math.round(seed.health.body.find(m => m.k === 'rhr')?.current ?? 0) || '·'}<small> bpm</small></div><div className="k">RESTING HR</div></div>
              <div><div className="v">{Math.round(seed.health.body.find(m => m.k === 'hrv')?.current ?? 0) || '·'}<small> ms</small></div><div className="k">HRV</div></div>
            </div>
          </div>
          <WorkoutCard
            d={d}
            done={false}
            result={result}
            runData={runData}
            runLoading={runLoading}
            shoes={seed.shoes}
            seedShoe={(seed.todayShoeId != null
              ? seed.shoes.find(s => s.id === seed.todayShoeId)?.nm
              : null) ?? seed.shoeRecByType[d.type] ?? KIT[d.type].shoe}
            persistShoe={curDay === seed.todayIdx}
          />
        </div>
      )}

      <Tiles seed={seed} onOpenRace={onOpenRace} />
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
  splits: Array<{ mile: number; pace: string | null; elev_change_ft: number | null; hr?: number | null }>;
  route_polyline?: string | null;
  distance_mi?: number;
  hrZonePcts?: { z1: number; z2: number; z3: number; z4: number; z5: number } | null;
  /** "Hotter than usual" context computed by run-state.ts vs the runner's
   *  14-day baseline at this lat/lon. Set when the delta is ≥8°F. */
  weather_context?: { message: string; hr_bump_bpm: number } | null;
  /** Phase-by-phase breakdown from coach_intents watch_completion payload.
   *  Drives THE REPS card for intervals · warmup/cooldown/recovery rows
   *  + per-rep plan-vs-result bars. Empty array for Strava/HK runs that
   *  weren't piloted by Faff watch. 2026-06-02 wired through. */
  phase_breakdown?: Array<{
    index: number;
    label: string;
    type: 'warmup' | 'work' | 'recovery' | 'cooldown' | 'unknown';
    target_pace: string | null;
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
      <div className="wcl">RESULT <span style={{ color: '#7BE8A0', marginLeft: 6 }}>✓ COMPLETED</span></div>
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
          <div className="kcl" style={{ margin: '18px 0 9px' }}>MILE SPLITS</div>
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
          <SessionBlueprintChart data={data} />
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

/** The SVG itself. Pure render from BlueprintData. */
function SessionBlueprintChart({ data }: { data: BlueprintData }) {
  // v2 sizing per design handoff · taller viewBox so the chart fills
  // the .sb-chartwrap flex:1 column and absorbs extra card height.
  const W = 712;
  const H = 288;
  const padL = 30;
  const padR = 16;
  const hasReps = data.segs.some(s => !!s.reps);
  const padT = hasReps ? 56 : 30;
  const padB = 30;
  const x0 = padL;
  const x1 = W - padR;
  const y0 = H - padB;
  const y1 = padT;
  const laneH = (y0 - y1) / 5;
  const total = data.totalMi;
  const xOf = (mi: number) => x0 + (mi / total) * (x1 - x0);
  // Stable id for the gradient (per-mount).
  const gradId = `sb-sheen-${Math.random().toString(36).slice(2, 8)}`;

  // Lanes background · alternating row tint + a horizontal line at the
  // top of each lane + a Z-label gutter on the left.
  const lanes: React.ReactNode[] = [];
  for (let zz = 1; zz <= 5; zz++) {
    const ly = y0 - (zz - 1) * laneH;
    const lt = ly - laneH;
    if (zz % 2 === 0) {
      lanes.push(<rect key={`zb-${zz}`} x={x0} y={lt} width={x1 - x0} height={laneH} fill="rgba(255,255,255,.05)" />);
    }
    lanes.push(<line key={`zl-${zz}`} x1={x0} y1={ly} x2={x1} y2={ly} stroke="rgba(255,255,255,.12)" strokeWidth={1} />);
    lanes.push(
      <text key={`zt-${zz}`} x={x0 - 8} y={ly - laneH / 2 + 3} textAnchor="end" fontFamily="Oswald" fontSize="9" fill="rgba(255,255,255,.5)">
        Z{zz}
      </text>
    );
  }

  // Blocks · one per segment. Rep blocks render as a comb of work bars
  // + N-1 float bars with a bracket label above.
  const blocks: React.ReactNode[] = [];
  data.segs.forEach((seg, segIdx) => {
    const bx = xOf(seg.from);
    const bw = xOf(seg.to) - xOf(seg.from);
    const bh = seg.zone * laneH;
    const by = y0 - bh;

    if (seg.reps && seg.reps > 0) {
      const n = seg.reps;
      const units = n * 2 + (n - 1); // each rep = 2 units, each rest = 1 unit
      const uW = bw / units;
      const repBh = 5 * laneH;
      const repBy = y0 - repBh;
      const floBh = 1.3 * laneH;
      const floBy = y0 - floBh;
      const floCol = '#48B3B5';
      let cxp = bx;
      for (let r = 0; r < n; r++) {
        const rw = 2 * uW;
        blocks.push(
          <rect key={`rep-${segIdx}-${r}-fill`} x={cxp + 1} y={repBy} width={rw - 2} height={repBh} rx={4} fill={seg.color} opacity={0.96} />,
          <rect key={`rep-${segIdx}-${r}-sheen`} x={cxp + 1} y={repBy} width={rw - 2} height={repBh} rx={4} fill={`url(#${gradId})`} />,
        );
        cxp += rw;
        if (r < n - 1) {
          blocks.push(
            <rect key={`flo-${segIdx}-${r}-fill`} x={cxp} y={floBy} width={uW} height={floBh} rx={3} fill={floCol} opacity={0.85} />,
            <rect key={`flo-${segIdx}-${r}-sheen`} x={cxp} y={floBy} width={uW} height={floBh} rx={3} fill={`url(#${gradId})`} />,
          );
          cxp += uW;
        }
      }
      // Bracket + label above the comb.
      const bxs = bx + 1;
      const bxe = bx + bw - 1;
      const byr = repBy - 9;
      const gcx = bx + bw / 2;
      blocks.push(
        <path
          key={`bracket-${segIdx}`}
          d={`M${bxs} ${byr + 5} L${bxs} ${byr} L${bxe} ${byr} L${bxe} ${byr + 5}`}
          fill="none" stroke="rgba(255,255,255,.5)" strokeWidth={1.3}
        />,
        <text
          key={`bracket-lbl-${segIdx}`}
          x={gcx} y={byr - 6} textAnchor="middle"
          fontFamily="Inter" fontSize="11.5" fontWeight={800} letterSpacing=".3" fill="#fff"
        >
          {seg.label}
          {seg.pace ? (
            <tspan fontFamily="Oswald" fontWeight={700} fill="rgba(255,255,255,.82)">
              {' '}@ {seg.pace}
              {seg.repDistanceLabel ? ` /${seg.repDistanceLabel.replace(/\s+/g, '')}` : ''}
            </tspan>
          ) : null}
        </text>
      );
      return;
    }

    // Standard block · rounded rect with sheen overlay.
    blocks.push(
      <rect key={`b-${segIdx}-fill`} x={bx + 2} y={by} width={Math.max(0, bw - 4)} height={bh} rx={8} fill={seg.color} opacity={0.96} />,
      <rect key={`b-${segIdx}-sheen`} x={bx + 2} y={by} width={Math.max(0, bw - 4)} height={bh} rx={8} fill={`url(#${gradId})`} />,
    );

    // Left-anchored text · NAME · big pace · "X mi · Zn" when block tall enough.
    const tx = bx + 14;
    blocks.push(
      <text key={`bl-${segIdx}`} x={tx} y={by + 19} fontFamily="Inter" fontSize="9.5" fontWeight={800} letterSpacing="1" fill="rgba(255,255,255,.82)">
        {seg.label.toUpperCase()}
      </text>
    );
    if (seg.pace) {
      blocks.push(
        <text key={`bp-${segIdx}`} x={tx} y={by + 41} fontFamily="Oswald" fontSize="20" fontWeight={700} fill="#fff">
          {seg.pace}
          <tspan fontSize="11" fill="rgba(255,255,255,.72)"> /mi</tspan>
        </text>
      );
    }
    if (bh > 62) {
      const segMi = (seg.to - seg.from);
      blocks.push(
        <text key={`bm-${segIdx}`} x={tx} y={by + bh - 11} fontFamily="Oswald" fontSize="11" fontWeight={600} fill="rgba(255,255,255,.7)">
          {segMi.toFixed(segMi === Math.round(segMi) ? 0 : 1)} mi · {seg.zn}
        </text>
      );
    }
  });

  // Mile ruler · ticks every 1 mi (≤10 total) or 2 mi (longer), with a
  // closing "MI" label at the right edge.
  const ruler: React.ReactNode[] = [
    <line key="r-base" x1={x0} y1={y0} x2={x1} y2={y0} stroke="rgba(255,255,255,.35)" strokeWidth={1.4} />,
  ];
  const stepMi = total > 10 ? 2 : 1;
  for (let t = 0; t <= total + 0.001; t += stepMi) {
    const rx2 = xOf(t);
    ruler.push(
      <line key={`rt-${t}`} x1={rx2} y1={y0} x2={rx2} y2={y0 + 4} stroke="rgba(255,255,255,.45)" strokeWidth={1.2} />,
      <text key={`rl-${t}`} x={rx2} y={y0 + 16} textAnchor="middle" fontFamily="Oswald" fontSize="9.5" fill="rgba(255,255,255,.55)">
        {t}
      </text>
    );
  }
  ruler.push(
    <text key="r-end" x={x1} y={y0 + 16} textAnchor="end" fontFamily="Oswald" fontSize="9.5" fill="rgba(255,255,255,.5)">MI</text>
  );

  // Fuel pins · dashed line starting BELOW the GEL label, drop icon
  // above the dashed start.
  const fuel: React.ReactNode[] = [];
  data.fuelMi.forEach((f, i) => {
    const fx = xOf(f);
    fuel.push(
      <line key={`f-${i}-line`} x1={fx} y1={y1 + 28} x2={fx} y2={y0} stroke="rgba(255,255,255,.4)" strokeWidth={1} strokeDasharray="2 3" />,
      <path
        key={`f-${i}-icn`}
        d={`M${fx} ${y1 + 5 - 8} C${fx + 5} ${y1 + 5 - 2} ${fx + 4.5} ${y1 + 5 + 4} ${fx} ${y1 + 5 + 4} C${fx - 4.5} ${y1 + 5 + 4} ${fx - 5} ${y1 + 5 - 2} ${fx} ${y1 + 5 - 8} Z`}
        fill="rgba(255,255,255,.92)"
      />,
      <text key={`f-${i}-lbl`} x={fx} y={y1 + 22} textAnchor="middle" fontFamily="Oswald" fontSize="8" fontWeight={700} fill="rgba(255,255,255,.78)">GEL</text>
    );
  });

  return (
    <svg className="sb-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.26" />
          <stop offset="42%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {lanes}
      {blocks}
      {ruler}
      {fuel}
    </svg>
  );
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
    return { value: `< ${d.hrCap}`, sub: ` bpm · ${d.type === 'long' ? 'Z3' : 'Z2'}` };
  }
  return { value: 'by feel', sub: '' };
}

function PlannedHeroV2({
  d, shoes, seedShoe, persistShoe, cadenceBaseline, skipped, onToggleSkip,
}: {
  d: FaffSeed['week'][number];
  shoes: FaffSeed['shoes'];
  seedShoe: string;
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
      <div className="hmain">
        <div className="htag">{(d.today ? 'TODAY' : d.dw) + ' · ' + d.type.toUpperCase() + ' · ' + eyebrowState}</div>
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
              <div className="kcv">{kit.fuel?.trim() && kit.fuel !== ' · ' ? kit.fuel : 'Water'}</div>
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
        coachLine={kit.coach}
      />

      <aside className="wcard">
        <div className="wcl">
          THE PLAN
          <span className="tag">{planTag}</span>
        </div>
        <div className="verdict">{planV}</div>
        <div className="recap">{planR}</div>
        <div className="divider" />
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
  if (!f) return '6–8 AM';
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
  seedShoe: string;
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
  const zoneColors = ['#54ddd0', '#8ef0b0', '#ffe0a0', '#ff9560', '#ff5a52'];
  const peakHr = runData?.hr_max ?? result?.peak ?? null;

  // Render every split the run carries (was capped at 8 · landed
  // 2026-05-31 after David flagged a 12.1mi long run rendering only
  // splits 1-8). The CSS in .splits handles long lists with its own
  // scroll/overflow.
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

  const onPlan = (() => {
    if (plannedMi <= 0) return false;
    if (isEasy && easyShare != null) {
      // Easy doctrine · stayed easy + didn't bomb the distance.
      return easyShare >= 85 && actualMi >= plannedMi * 0.75 && actualMi <= plannedMi * 1.2;
    }
    // Quality / long / fallback · ±15% distance window.
    return actualMi >= plannedMi * 0.85 && actualMi <= plannedMi * 1.15;
  })();

  // 2026-06-03 · HOT DAY rescue · when heat-bump is significant (≥5 bpm
  // physiological cost) AND the runner ran the right distance on an
  // easy day, badge says HOT DAY regardless of easyShare. The recap
  // text already explains the heat ("63°F → 68°F · costs you 9% on
  // pace"); the badge should match that nuance instead of contradicting
  // it with OFF PLAN. Previously hot-day only rescued on-plan runs ·
  // the runner whose HR drifted into Z3 BECAUSE of heat got punished
  // for honest execution. Cite: prior David flag 2026-06-03.
  const distanceWithinEasyTolerance =
    plannedMi > 0 && actualMi >= plannedMi * 0.75 && actualMi <= plannedMi * 1.2;
  const heatRescue = isEasy && heatBump >= 5 && distanceWithinEasyTolerance;

  const verdictBadge: 'on-plan' | 'hot-day' | 'off-plan' =
    onPlan && heatBump >= 5 ? 'hot-day'
    : heatRescue ? 'hot-day'    // off-plan-by-zones but heat explains it
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
      <div className="hmain">
        <div className="htag">{(d.today ? 'TODAY' : d.dw) + ' · ' + d.type.toUpperCase() + ' · DONE'}</div>
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
                  <div key={zi} style={p === 0 ? { opacity: 0.4 } : undefined}>
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
              <div>
                <div className="kcl">ELEV GAIN{elevSuspicious ? ' · APPROX' : ''}</div>
                <div className="kcv" style={elevSuspicious ? { color: 'rgba(246,247,248,0.62)' } : undefined}>
                  {resolvedGainFt != null && resolvedGainFt > 0 ? `${resolvedGainFt} ft` : '·'}
                </div>
              </div>
              <div>
                <div className="kcl">{runData?.power_avg_w != null ? 'AVG POWER' : 'CALORIES'}</div>
                <div className="kcv">{runData?.power_avg_w != null ? `${runData.power_avg_w} W` : (result?.cal && result.cal > 0 ? `${result.cal} kcal` : '·')}</div>
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
            {recapPayload?.conditions_note ? (
              <div style={{
                marginTop: 18, padding: '10px 12px', borderRadius: 8,
                background: 'rgba(255,136,71,0.12)', border: '1px solid rgba(255,136,71,0.32)',
                fontSize: 12, lineHeight: 1.5, color: '#FFE7C2',
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: '1.2px',
                  textTransform: 'uppercase', color: '#FF8847', marginBottom: 4,
                }}>
                  CONDITIONS
                </div>
                {recapPayload.conditions_note}
              </div>
            ) : runData?.weather_context ? (
              <div style={{
                marginTop: 18, padding: '8px 10px', borderRadius: 8,
                background: 'rgba(255,136,71,0.12)', border: '1px solid rgba(255,136,71,0.32)',
                fontSize: 12, lineHeight: 1.45, color: '#FFE7C2',
              }}>
                {runData.weather_context.message}
                {runData.weather_context.hr_bump_bpm > 0 ? (
                  <> · HR +{runData.weather_context.hr_bump_bpm} bpm expected</>
                ) : null}
              </div>
            ) : null}

            {recapPayload?.coach_tip ? (
              <div style={{
                marginTop: 8, padding: '10px 12px', borderRadius: 8,
                background: 'rgba(85, 221, 208, 0.10)', border: '1px solid rgba(85, 221, 208, 0.32)',
                fontSize: 12, lineHeight: 1.5, color: '#cfeeec',
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 800, letterSpacing: '1.2px',
                  textTransform: 'uppercase', color: '#54ddd0', marginBottom: 4,
                }}>
                  COACH TIP
                </div>
                {recapPayload.coach_tip}
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
              color: '#8af0a6',
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
              color: '#ff6a6a',
            }}>OFF PLAN</span>
          )}
        </div>
        <div className="recap">{recap}</div>

        {/* CONDITIONS + COACH TIP + CITATIONS moved into the leftstack
            (2026-05-31 redistribution) so the wcard stays trim and the
            three columns balance vertically. The right card now holds
            just the verdict / recap / mile splits. */}

        <div className="divider" />
        {/* 2026-06-02 · for interval workouts WITH per-phase data, swap the
            generic mile-splits panel for THE REPS plan-vs-result card.
            See designs/from Design agent/design_handoff_run_detail_intervals.
            Falls back to MILE SPLITS for runs without phase_breakdown (easy,
            long, Strava/HK runs, or interval runs where the watch payload
            didn't carry phase data). */}
        {d.type === 'intervals' && runData?.phase_breakdown && runData.phase_breakdown.length > 0 ? (
          <RepsRail phases={runData.phase_breakdown} />
        ) : (d.type === 'easy' || d.type === 'recovery') && splits.length >= 3 ? (
          <EasyPanel
            hrZonePcts={runData?.hrZonePcts ?? null}
            splits={splits}
            hrAvg={runData?.hr_avg ?? null}
          />
        ) : d.type === 'long' && runData?.phase_breakdown && runData.phase_breakdown.some(p => p.type === 'work') ? (
          // Long-run WITH a work phase = MP-finish variant · "THE BUILD".
          <LongMpPanel phases={runData.phase_breakdown} splits={splits} />
        ) : d.type === 'long' && splits.length >= 3 ? (
          <LongPanel splits={splits} avgPace={resolvedPace ?? null} />
        ) : d.type === 'tempo' && runData?.phase_breakdown && runData.phase_breakdown.length > 0 ? (
          <TempoPanel phases={runData.phase_breakdown} />
        ) : (
          <>
            <div className="reshead">
              <span>MILE SPLITS</span>
              {resolvedPace && <span className="rs">avg {resolvedPace}<small>/mi</small></span>}
            </div>
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
function RepsRail({ phases }: { phases: RepsPhase[] }) {
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
  const firstWorkTargetDur = workPhases.find(p => p.target_duration_sec != null)?.target_duration_sec ?? null;
  const maxdev = Math.max(4, Math.round((firstWorkTargetDur ?? goalSec) * 0.04));
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
      <div className="reshead">
        <span>THE REPS</span>
        {goalSec > 0 && (
          <span className="rs">
            TARGET <b>{fmtSecAsPace(goalSec)}</b><small>/mi</small>
          </span>
        )}
      </div>
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
          <span style={{ color: '#ffb24d', opacity: 0.85 }}>◂ SLOWER</span>
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,.45)',
          }}>TARGET</span>
          <span style={{ color: '#3ED06a', opacity: 0.9 }}>FASTER ▸</span>
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
            const fillColor = beat ? '#3ED06a' : '#ffb24d';
            const deltaColor = beat ? '#3ED06a' : '#ffb24d';
            // Diverging bar math · same as the design's session-driven JS:
            //   d > 0 (slower) → fill from (50 - mag)% leftward toward SLOWER
            //   d < 0 (faster) → fill from 50% rightward toward FASTER
            //   d == 0         → small 6% nub centered at 47%
            const mag = delta != null && delta !== 0
              ? Math.max(4, Math.min(50, (Math.abs(delta) / maxdev) * 50))
              : 0;
            const fillW = onTarget ? 6 : mag;
            const fillLeft = onTarget ? 47 : (delta != null && delta > 0 ? TICK_PCT - mag : TICK_PCT);
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
                  {fillW > 0 && (
                    <div style={{
                      position: 'absolute', top: 1, bottom: 1,
                      left: `${fillLeft}%`, width: `${fillW}%`,
                      background: fillColor,
                      borderRadius: 3,
                      transition: 'left 240ms, width 240ms',
                    }} />
                  )}
                  {/* goal tick · centered, 2px white line, extends 2px above/below,
                      sits ABOVE the fill so it's always visible at center. */}
                  <div style={{
                    position: 'absolute', left: `${TICK_PCT}%`,
                    top: -2, bottom: -2, width: 2,
                    background: 'rgba(255,255,255,.92)', zIndex: 3,
                    transform: 'translateX(-1px)',
                    borderRadius: 1,
                    boxShadow: '0 0 0 1px rgba(0,0,0,.2)',
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
                color: avgWorkBeat ? '#3ED06a' : '#ffb24d',
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
  hrZonePcts, splits, hrAvg,
}: {
  hrZonePcts: { z1: number; z2: number; z3: number; z4: number; z5: number } | null | undefined;
  splits: Array<{ mile: number; pace: string | null; elev_change_ft: number | null; hr?: number | null }>;
  hrAvg: number | null;
}) {
  // KEPT IT EASY · Z1+Z2 share.
  const easyPct = hrZonePcts
    ? Math.round((hrZonePcts.z1 ?? 0) + (hrZonePcts.z2 ?? 0))
    : null;
  const easyTone: 'good' | 'warn' | 'bad' = easyPct == null
    ? 'good' : easyPct >= 85 ? 'good' : easyPct >= 70 ? 'warn' : 'bad';
  const easyColor = easyTone === 'good' ? '#3ED06a' : easyTone === 'warn' ? '#ffb24d' : '#ff6a6a';

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
  const driftBand: { text: string; color: string } | null = hrDelta == null
    ? null
    : Math.abs(hrDelta) <= 4 ? { text: 'STAYED FLAT', color: '#3ED06a' }
    : Math.abs(hrDelta) <= 8 ? { text: 'SOME DRIFT', color: '#ffb24d' }
    : { text: 'LATE FADE', color: '#ff6a6a' };

  // Mile pace footprint · per-mile pace in seconds.
  const paceSecs = splits.map(s => paceToSec(s.pace ?? '')).filter(n => n > 0);
  const fastest = paceSecs.length ? Math.min(...paceSecs) : 0;
  const slowest = paceSecs.length ? Math.max(...paceSecs) : 0;
  const avgPaceSec = paceSecs.length
    ? Math.round(paceSecs.reduce((a, b) => a + b, 0) / paceSecs.length) : 0;

  // Footprint bar heights · taller = faster. Anchor on min/max with avg as
  // a dashed reference line.
  const FONT_DISP = "var(--font-display, 'Oswald', sans-serif)";
  const fpAll = [...paceSecs, avgPaceSec].filter(n => n > 0);
  const fpMin = fpAll.length ? Math.min(...fpAll) : 0;
  const fpMax = fpAll.length ? Math.max(...fpAll) : 1;
  const fpRng = Math.max(1, fpMax - fpMin);
  const fpH = (s: number) => 30 + ((fpMax - s) / fpRng) * 64;

  return (
    <>
      {/* phead */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        margin: '16px 0 4px',
      }}>
        <span style={{
          fontFamily: FONT_DISP, fontSize: 15, fontWeight: 600, letterSpacing: 0.5,
        }}>AEROBIC STAMP</span>
      </div>

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
          }}>Z1–Z2 share of moving time</div>
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
              Same pace throughout, but your heart{' '}
              <b style={{
                fontFamily: FONT_DISP, fontWeight: 600, fontSize: 13, color: driftBand.color,
              }}>{(hrDelta ?? 0) >= 0 ? '+' : ''}{hrDelta} bpm</b>
              {(hrDelta ?? 0) >= 0 ? ' faster in the back half. ' : ' lower in the back half. '}
              {driftBand.text === 'STAYED FLAT' && 'The engine stayed flat · a genuinely easy run.'}
              {driftBand.text === 'SOME DRIFT' && 'Some late drift · keep the back half honest next time.'}
              {driftBand.text === 'LATE FADE' && 'The engine worked harder to hold the same pace by the back half.'}
            </div>
          </div>
        </div>
      ) : null}

      {/* MILE PACE footprint */}
      {paceSecs.length >= 3 && avgPaceSec > 0 ? (
        <div style={{ marginTop: 18 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4 }}>MILE PACE</span>
          <div style={{
            position: 'relative', display: 'flex', alignItems: 'flex-end',
            gap: 5, height: 46, marginTop: 11, paddingRight: 50,
          }}>
            <div style={{
              position: 'absolute', left: 0, right: 50,
              top: `${(100 - fpH(avgPaceSec)).toFixed(1)}%`,
              borderTop: '1px dashed rgba(255,255,255,.4)', zIndex: 2,
            }}>
              <span style={{
                position: 'absolute', left: 'calc(100% + 7px)', top: -7,
                whiteSpace: 'nowrap', fontSize: 8.5, fontWeight: 700,
                color: 'rgba(255,255,255,.8)',
              }}>{fmtSecAsPace(avgPaceSec)} avg</span>
            </div>
            {paceSecs.map((s, i) => (
              <div key={i} style={{
                flex: 1, borderRadius: '3px 3px 1px 1px',
                background: 'linear-gradient(180deg, #5fdba6, #37c98f)',
                minHeight: 5, height: `${Math.round(fpH(s))}%`,
              }} />
            ))}
          </div>
          <div style={{
            display: 'flex', gap: 5, marginTop: 6, paddingRight: 50,
          }}>
            {paceSecs.map((_, i) => (
              <span key={i} style={{
                flex: 1, textAlign: 'center', fontSize: 8.5, fontWeight: 600,
                color: 'rgba(255,255,255,.42)',
              }}>{i + 1}</span>
            ))}
          </div>
          <div style={{
            fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,.5)', marginTop: 8,
          }}>
            {paceSecs.length} miles · fastest {fmtSecAsPace(fastest)} · slowest {fmtSecAsPace(slowest)} · {slowest - fastest}s spread
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
  splits, avgPace,
}: {
  splits: Array<{ mile: number; pace: string | null; elev_change_ft: number | null; hr?: number | null }>;
  avgPace: string | null;
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

  const driftBand: { text: string; color: string } | null = hrDelta == null
    ? null
    : hrDelta <= 4 ? { text: 'HELD STEADY', color: '#3ED06a' }
    : hrDelta <= 8 ? { text: 'SOME DRIFT', color: '#ffb24d' }
    : { text: 'LATE FADE', color: '#ff6a6a' };

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
      {/* phead */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        margin: '16px 0 4px',
      }}>
        <span style={{
          fontFamily: FONT_DISP, fontSize: 15, fontWeight: 600, letterSpacing: 0.5,
        }}>THE LONG</span>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
          color: 'rgba(255,255,255,.6)',
        }}>{n} MI</span>
      </div>

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
                marginTop: 8, lineHeight: 1, color: warn ? '#ffb24d' : undefined,
              }}>{t.paceSec > 0 ? fmtSecAsPace(t.paceSec) : '·'}</div>
              <div style={{
                fontSize: 11, fontWeight: 600, opacity: 0.78, marginTop: 8,
                color: warn ? '#ffb24d' : undefined,
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
              {driftBand.text === 'HELD STEADY' && ' The engine held all the way through.'}
              {driftBand.text === 'SOME DRIFT' && ' Normal late-run rise · the engine worked harder to hold the same pace.'}
              {driftBand.text === 'LATE FADE' && ' Normal late-run fade · fuel a touch earlier next time.'}
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
                fontSize: 11, fontWeight: 700, marginLeft: 5, color: '#ffb24d',
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
}: { phases: NonNullable<RunSummary['phase_breakdown']> }) {
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

  // cmpBar math · same model as RepsRail.
  const maxdev = Math.max(4, Math.round((work.target_duration_sec ?? actualSec ?? 432) * 0.04));
  const fillW = delta == null || onTarget
    ? (onTarget ? 6 : 0)
    : Math.max(5, Math.min(50, (Math.abs(delta) / maxdev) * 50));
  const fillLeft = onTarget ? 47 : (delta != null && delta > 0 ? 50 - fillW : 50);

  return (
    <>
      {/* phead */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        margin: '16px 0 4px',
      }}>
        <span style={{
          fontFamily: FONT_DISP, fontSize: 15, fontWeight: 600, letterSpacing: 0.5,
        }}>THE TEMPO</span>
        {distLabel ? (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
            color: 'rgba(255,255,255,.6)',
          }}>{distLabel}</span>
        ) : null}
      </div>

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
        {/* Comparison bar · target = center tick */}
        <div style={{
          position: 'relative', height: 12, borderRadius: 6,
          background: 'rgba(255,255,255,.1)', marginTop: 10,
        }}>
          {fillW > 0 && (
            <div style={{
              position: 'absolute', top: 1, bottom: 1,
              left: `${fillLeft}%`, width: `${fillW}%`,
              background: beat ? '#3ED06a' : '#ffb24d',
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
          <span style={{ color: '#ffb24d', opacity: 0.85 }}>◂ SLOWER</span>
          <span style={{ color: 'rgba(255,255,255,.45)' }}>TARGET</span>
          <span style={{ color: '#3ED06a', opacity: 0.9 }}>FASTER ▸</span>
        </div>
      </div>

      {/* HR ACROSS THE BLOCK · three mini cards.
          Use phase avg_hr if max_hr exists then synthesize early/middle/late
          as avg ± a fraction. When max_hr is missing we just show avg three
          times. Better than nothing; when phase data has finer granularity
          later this becomes actual sampled thirds. */}
      {work.avg_hr != null ? (
        <div style={{ marginTop: 18 }}>
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
                  marginTop: 8, lineHeight: 1, color: card.warn ? '#ffb24d' : undefined,
                }}>{card.bpm}</div>
                <div style={{
                  fontSize: 11, fontWeight: 600, opacity: 0.78, marginTop: 8,
                  color: card.warn ? '#ffb24d' : undefined,
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
            <span style={{
              fontSize: 11, fontWeight: 700, marginLeft: 5,
              color: beat ? '#3ED06a' : '#ffb24d',
            }}>
              · {delta > 0 ? `+${delta}` : delta} vs goal
            </span>
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
  const shiftTone = shiftDrop == null ? '#3ED06a'
    : shiftDrop >= 45 ? '#3ED06a'
    : shiftDrop >= 30 ? '#3ED06a'
    : '#ffb24d';
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
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        margin: '16px 0 4px',
      }}>
        <span style={{
          fontFamily: FONT_DISP, fontSize: 15, fontWeight: 600, letterSpacing: 0.5,
        }}>THE BUILD</span>
        {baseDist > 0 && work.target_distance_mi != null ? (
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
            color: 'rgba(255,255,255,.6)',
          }}>
            {Math.round(baseDist + work.target_distance_mi)} MI · {Math.round(baseDist)} + {Math.round(work.target_distance_mi)}
          </span>
        ) : null}
      </div>

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
        <div style={{ textAlign: 'center', margin: '16px 0 4px' }}>
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
              background: mpBeat ? '#3ED06a' : '#ffb24d',
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
          <span style={{ color: '#ffb24d', opacity: 0.85 }}>◂ SLOWER</span>
          <span style={{ color: 'rgba(255,255,255,.45)' }}>TARGET</span>
          <span style={{ color: '#3ED06a', opacity: 0.9 }}>FASTER ▸</span>
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
                  color: chip.warn ? '#ffb24d' : '#fff', marginLeft: 3,
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
              color: mpBeat ? '#3ED06a' : '#ffb24d',
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

function WorkoutCard({ d, done, result, runData, runLoading, shoes, seedShoe, persistShoe }: { d: FaffSeed['week'][number]; done: boolean; result?: FaffSeed['results'][number]; runData: RunSummary | null; runLoading: boolean; shoes: FaffSeed['shoes']; seedShoe: string; persistShoe: boolean }) {
  if (done) {
    return <CompletedResultCard d={d} fallback={result} runData={runData} loading={runLoading} />;
  }
  // Rest day gets a recovery-focused panel, not the workout shape.
  if (d.type === 'rest') {
    return (
      <div className="wcard">
        <div className="wcl">RECOVERY</div>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 28, fontWeight: 600, lineHeight: 1, marginTop: 4 }}>Today is for healing.</div>
        <div style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.5, opacity: 0.86, marginTop: 12 }}>
          Six days on. This is where the work sets in. Sleep, hydrate, mobilize. Let the load land.
        </div>
        <div className="kit" style={{ marginTop: 22 }}>
          <div className="kc"><div className="kcl">SLEEP TARGET</div><div className="kcv">8h</div></div>
          <div className="kc"><div className="kcl">MOBILITY</div><div className="kcv">15 min</div></div>
          <div className="kc"><div className="kcl">FUEL</div><div className="kcv">Balanced + hydrate</div></div>
        </div>
        <div className="wcoach"><span className="ct">COACH</span>Rest is training. An easy 20-min walk is fine, but do not turn it into a session.</div>
      </div>
    );
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

function ShoePicker({ shoes, initial, persist, runId }: { shoes: FaffSeed['shoes']; initial: string; persist: boolean; runId?: string | null }) {
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
    return <div className="kcv">{picked}</div>;
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

  return (
    <div ref={triggerRef} style={{ display: 'inline-block' }}>
      <div
        className="kcv"
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, opacity: saving ? 0.7 : 1 }}
        onClick={() => setOpen(o => !o)}
        role="button"
        tabIndex={0}
      >
        {picked}
        <span style={{ fontSize: 9, opacity: 0.55 }}>▾</span>
      </div>
      {menu}
    </div>
  );
}

function Tiles({ seed, onOpenRace }: { seed: FaffSeed; onOpenRace: () => void }) {
  const goal = seed.goalRace;
  const [hoverBar, setHoverBar] = useState<number | null>(null);
  const bar = hoverBar != null ? seed.volumeBars[hoverBar] : null;
  const num = bar ? `${bar.mi}` : `${seed.thisWeekMiles}`;
  const sub = bar ? ` mi · ${bar.label}` : ` mi · 8-wk avg ${seed.weeklyAvg}`;

  return (
    <div className="tiles">
      <div className="tile">
        <div className="fll">THE GAP{goal ? ` · ${goal.name.toUpperCase().replace(' MARATHON','').slice(0,12)}` : ''}</div>
        <div className="tbody cd">
          {/* 2026-05-30: when projection hasn't computed (no recent race result
              yet → no VDOT seed), show the goal as the big number so the tile
              doesn't read as broken. Bottom row explains why. */}
          <div className="cdbig" style={{ color: goal?.projected ? (goal.onTrack ? '#3EBD41' : '#FF8847') : '#9099A8' }}>
            {goal?.projected ?? goal?.goal ?? '—'}
          </div>
          <div className="cdlab">{goal?.projected ? 'PROJECTED FINISH' : (goal ? 'TARGET FINISH' : 'NO GOAL SET')}</div>
          {goal?.projected
            ? <div className="cdsub">Goal {goal.goal} · {goal.delta}</div>
            : (goal ? <div className="cdsub" style={{ opacity: 0.7 }}>Log a recent race to project</div> : <div className="cdsub" style={{ opacity: 0.7 }}>Pick a primary race on /races</div>)}
          <div className="cdbar"><div className="cdfill" style={{ width: `${goal?.goalPct ?? 0}%`, background: goal?.onTrack ? '#3EBD41' : '#FF8847' }} /></div>
          <div className="cdwk" style={{ color: goal?.onTrack ? '#7BE8A0' : '#FFCE8A', opacity: 1 }}>
            {goal
              ? (goal.projected
                  ? (goal.onTrack ? `On track for ${goal.goal}` : `${goal.delta}`)
                  : 'Projection pending')
              : 'No goal race set'}
          </div>
        </div>
      </div>

      <div className="tile click" onClick={onOpenRace} role="button" tabIndex={0}>
        <div className="fll">RACE DAY{goal ? ` · ${goal.name.toUpperCase().replace(' MARATHON','').slice(0,12)}` : ''}</div>
        <div className="tbody cd">
          <div className="cdbig">{goal?.daysAway ?? '—'}</div>
          <div className="cdlab">{goal ? 'DAYS TO GO' : 'NO GOAL SET'}</div>
          <div className="cdsub" style={{ opacity: goal ? 1 : 0.7 }}>
            {goal ? `${formatDate(goal.date)}${goal.location ? ' · ' + goal.location : ''}` : 'Pick a primary race on /races'}
          </div>
          <div className="cdbar"><div className="cdfill" style={{ width: `${goal?.goalPct ?? 0}%` }} /></div>
          <div className="cdwk">{goal?.phaseLabel ?? (goal ? 'Building' : '—')}</div>
        </div>
      </div>

      <div className="tile">
        <div className="fll">WEEKLY VOLUME</div>
        <div className="tbody vfill">
          <div className="vol">
            {seed.volumeBars.map((b, i) => (
              <i
                key={i}
                onMouseEnter={() => setHoverBar(i)}
                onMouseLeave={() => setHoverBar(null)}
                style={{
                  height: `${(b.mi / Math.max(...seed.volumeBars.map(x => x.mi))) * 100}%`,
                  background: b.current ? '#FFFFFF' : 'rgba(255,255,255,.30)',
                }}
              />
            ))}
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
        const FORM_COLOR: Record<string, string> = {
          OVERREACH:    '#FC4D64',  // critical red · sustained negative load
          LOADED:       '#F3AD38',  // amber · high stress but productive
          PRODUCTIVE:   '#48B3B5',  // neutral teal · balanced
          'RACE-READY': '#3EBD41',  // green · post-taper primed
          DETRAINING:   '#F3AD38',  // amber · too fresh too long
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
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
}
