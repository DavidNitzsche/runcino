'use client';

/**
 * /today client surface — the rendering shell (v3 design).
 *
 * Composes the lifted Faff components against real production GlanceState
 * data (via lib/faff/glance-adapter.ts).
 *
 * The hero pair (Poster + Sibling) and WeekStrip use the new design;
 * BriefingLoader continues to render the LLM-backed coach voice below
 * the hero (preserves working behaviour during cutover).
 *
 * Simulator mode · Phase 13 (2026-05-28):
 *   When `activePersona` is non-null, a banner + chip strip render at the
 *   top of the page so the user can flip between persona fixtures without
 *   typing URLs. Each chip is a plain <Link href="/today?persona=<key>">
 *   so navigation is essentially free (server re-render only). A "Real
 *   data" pill at the end escapes simulator mode back to `/today`.
 *
 * Cardinal Rule #1: don't break what works. BriefingLoader, TopNav,
 * ReadinessChipTrigger keep their existing roles unchanged.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import type {
  PosterPayload,
  SiblingPayload,
  WeekStripPayload,
  DayState,
  WorkoutSpec,
} from '@/lib/faff/types';
import type { GlanceWeekDay } from '@/lib/coach/glance-state';
import { PERSONA_CATALOGUE, type PersonaKey } from '@/lib/faff/personas';
import { VerbHero } from '@/components/faff/VerbHero';
import { Sibling } from '@/components/faff/Sibling';
import { WeekStrip } from '@/components/faff/WeekStrip';
import { BodyGrid } from '@/components/faff/BodyGrid';
import { BCard } from '@/components/faff/BCard';
import { WorkoutBreakdown, type WorkoutData } from '@/components/faff/WorkoutBreakdown';
import { ReconnectBanner } from '@/components/strava/ReconnectBanner';
import { RaceBib } from '@/components/faff/RaceBib';
import { BodyChips } from '@/components/today/BodyChips';
import type { RaceHeader } from '@/lib/coach/race-header';

export interface TodayClientProps {
  poster: PosterPayload;
  sibling: SiblingPayload;
  week: WeekStripPayload;
  state: DayState;
  phaseLabel: string | null;
  // Paper-overhaul 2026-05-29 · the persistent race-bib header (spine) +
  // the readiness composite that drives the BODY chip.
  raceHeader: RaceHeader;
  readinessBand: 'sharp' | 'ready' | 'moderate' | 'pull-back' | null;
  readinessLabel: string | null;
  readinessScore: number | null;
  // Slots: the page wires the legacy briefing + readiness loaders here so
  // we can keep them rendering while the new shell takes over visually.
  briefingSlot?: ReactNode;
  errorSlot?: ReactNode;
  // Simulator mode · non-null when /today?persona=<key> is on the URL.
  activePersona?: PersonaKey | null;
  // Strava 401 reconnect banner — SSR-seeded so the warning appears on
  // first paint when the user's most-recent push 401'd. The banner refetches
  // /api/strava/status on mount to keep it live.
  stravaStatus?: 'connected' | 'needs_reauth' | 'disconnected';
  // P-NIGGLE-SICK 2026-05-28 · niggle/sick state + recovery signals for
  // the BodyFlags chip pair under the Sibling. Pulled from the loaded
  // GlanceState by the page (real or persona).
  activeNiggle: {
    id: number; body_part: string; severity: number;
    side: 'left' | 'right' | 'both' | null;
    status: 'just_started' | 'few_days' | 'weeks';
    logged_at: string; days_active: number;
  } | null;
  activeSick: {
    id: number; symptoms: string[]; has_fever: boolean;
    started: 'today' | 'yesterday' | 'few_days' | 'week_plus';
    logged_at: string; days_active: number;
  } | null;
  sleep7Avg: number | null;
  rhrCurrent: number | null;
  rhrBaseline: number | null;
  // Phase 32 (2026-05-28) · BodyGrid per-state real content. Slim slices
  // off GlanceState + a couple of derived lookups (slug, LTHR).
  hrvCurrent: number | null;
  hrvBaseline: number | null;
  loadAcwr: number | null;
  daysToARace: number | null;
  nextARaceName: string | null;
  nextARaceSlug: string | null;
  runnerLthrBpm: number | null;
  todayDay: GlanceWeekDay | null;
  tomorrowDay: GlanceWeekDay | null;
  yesterdayDay: GlanceWeekDay | null;
}

export function TodayClient({
  poster,
  sibling,
  week,
  state,
  phaseLabel,
  raceHeader,
  readinessBand,
  readinessLabel,
  readinessScore,
  briefingSlot,
  errorSlot,
  activePersona,
  stravaStatus,
  activeNiggle,
  activeSick,
  sleep7Avg,
  rhrCurrent,
  rhrBaseline,
  hrvCurrent,
  hrvBaseline,
  loadAcwr,
  daysToARace,
  nextARaceName,
  nextARaceSlug,
  runnerLthrBpm,
  todayDay,
  tomorrowDay,
  yesterdayDay,
}: TodayClientProps) {
  const phaseHeader = phaseLabel ? phaseLabel.toUpperCase() : undefined;
  const activeEntry = activePersona
    ? PERSONA_CATALOGUE.find((p) => p.key === activePersona) ?? null
    : null;

  // Phase 32 · gather the per-state context once and pass it down.
  const bodyContext: BodyContext = {
    state,
    phaseLabel,
    todayDay,
    tomorrowDay,
    yesterdayDay,
    hrvCurrent,
    hrvBaseline,
    loadAcwr,
    rhrCurrent,
    rhrBaseline,
    sleep7Avg,
    daysToARace,
    nextARaceName,
    nextARaceSlug,
    runnerLthrBpm,
    activeNiggle,
    activeSick,
    posterChoice: poster.choice_row,
  };

  return (
    <main style={{ minHeight: '100vh', paddingBottom: 80 }}>
      {/* STRAVA 401 RECONNECT BANNER · above persona switcher per spec
          2026-05-28. Renders only when the user's most-recent push 401'd.
          Self-fetches /api/strava/status to stay live across tabs. */}
      <ReconnectBanner initialState={stravaStatus} />

      {/* SIMULATOR BAR · only renders in persona mode. Banner + chip strip. */}
      {activeEntry && (
        <SimulatorBar activeKey={activeEntry.key} description={activeEntry.description} label={activeEntry.label} />
      )}

      <div
        style={{
          maxWidth: 1040,
          margin: '0 auto',
          padding: '28px 24px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        {/* ── RACE BIB · the spine. "Here's what stands between you and the
            finish line." Persistent header; renders base mode when no race
            is anchored. ── */}
        <RaceBib header={raceHeader} />

        {/* ── VERB HERO · the verb-as-mood-ring. Full-width (the old
            Poster + Sibling two-up is retired). The verb carries all the
            personality; the numbers below carry none. ── */}
        <VerbHero payload={poster} />

        {/* NEW USER · the only state that keeps the Sibling — it owns the
            onboarding/setup flow until a baseline + plan exist. */}
        {state === 'new_user' && <Sibling payload={sibling} bodyFlags={null} />}

        {/* ── BODY CHIPS · the 5-signal instrument strip (BODY / SLEEP / RHR /
            HRV / LOAD). Deterministic; each chip degrades to "—" when its
            signal is missing. Hidden for new_user (no baseline yet). ── */}
        {state !== 'new_user' && (
          <BodyChips
            readinessBand={readinessBand}
            readinessLabel={readinessLabel}
            readinessScore={readinessScore}
            sleep7Avg={sleep7Avg}
            rhrCurrent={rhrCurrent}
            rhrBaseline={rhrBaseline}
            hrvCurrent={hrvCurrent}
            hrvBaseline={hrvBaseline}
            loadAcwr={loadAcwr}
          />
        )}

        {/* ── THIS WEEK ── */}
        {week.days.length > 0 && <WeekStrip payload={week} phaseLabel={phaseHeader} />}

        {/* ── BODY GRID · per-state detail below the fold. Gated out for
            new_user (Sibling owns setup) and skipped (the hero already
            carries the skip framing — lower cards are redundant). Every
            other state ships real left + right content per the
            renderBodyLeft / renderBodyRight switches below. ── */}
        {state !== 'new_user' && state !== 'skipped' && (
          <BodyGrid
            sectionHeading={bodyHeadingFor(state)}
            sectionSuffix={bodySuffixFor(state)}
            left={renderBodyLeft(bodyContext)}
            right={renderBodyRight(bodyContext)}
          />
        )}

        {/* ── COACH · WHY THIS WORKOUT · the LLM-backed voice, kept below the
            deterministic surface during cutover. ── */}
        {briefingSlot && (
          <BCard header={{ label: 'COACH · WHY THIS WORKOUT' }}>
            {briefingSlot}
          </BCard>
        )}

        {errorSlot}
      </div>

      <style>{`
        .persona-chip-strip::-webkit-scrollbar { display: none; }
        .persona-chip-strip { scrollbar-width: none; }
        .persona-chip:hover { filter: brightness(0.97); }
        .persona-chip-active:hover { filter: brightness(1.04); }
        @media (max-width: 720px) {
          .body-chips { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </main>
  );
}

// ──────────────────────────────────────────────────────────────────────
// SimulatorBar · banner + chip strip + reset pill. Renders only when
// `?persona=<key>` is on the URL. Lives inline (not its own component
// file) because it's a simulator-only concern and shipping a separate
// file just to host it doesn't earn its keep.
// ──────────────────────────────────────────────────────────────────────

function SimulatorBar({
  activeKey,
  description,
  label,
}: {
  activeKey: PersonaKey;
  description: string;
  label: string;
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      {/* Banner */}
      <div
        style={{
          background: 'var(--card)',
          padding: '8px 32px',
          fontFamily: 'var(--f-body)',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: 'var(--ink)',
          textTransform: 'uppercase',
        }}
      >
        <span style={{ color: 'var(--over)' }}>SIMULATOR</span>
        <span style={{ color: 'var(--mute)', margin: '0 8px' }}>·</span>
        <span>{label}</span>
        <span
          style={{
            color: 'var(--mute)',
            fontWeight: 400,
            textTransform: 'none',
            letterSpacing: 0,
            marginLeft: 12,
            fontSize: 11,
          }}
        >
          {description}
        </span>
      </div>

      {/* Chip strip */}
      <div
        className="persona-chip-strip"
        style={{
          display: 'flex',
          gap: 8,
          padding: '10px 32px',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        {PERSONA_CATALOGUE.map((p) => (
          <PersonaChip key={p.key} personaKey={p.key} label={p.label} active={p.key === activeKey} />
        ))}
        <ResetChip />
      </div>
    </div>
  );
}

function PersonaChip({
  personaKey,
  label,
  active,
}: {
  personaKey: PersonaKey;
  label: string;
  active: boolean;
}) {
  const base = {
    padding: '6px 12px',
    borderRadius: 'var(--r-pill)',
    fontFamily: 'var(--f-body)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    textDecoration: 'none',
    flex: '0 0 auto',
    transition: 'background 120ms ease, filter 120ms ease',
  };
  const activeStyle = {
    ...base,
    background: 'var(--card2)',
    border: '1px solid var(--green)',
    color: 'var(--ink)',
  };
  const inactiveStyle = {
    ...base,
    background: 'transparent',
    border: '1px solid var(--line)',
    color: 'var(--mute)',
  };
  return (
    <Link
      href={`/today?persona=${personaKey}`}
      className={active ? 'persona-chip-active' : 'persona-chip'}
      style={active ? activeStyle : inactiveStyle}
    >
      {label}
    </Link>
  );
}

function ResetChip() {
  return (
    <Link
      href="/today"
      className="persona-chip"
      style={{
        padding: '6px 12px',
        borderRadius: 'var(--r-pill)',
        fontFamily: 'var(--f-body)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        textDecoration: 'none',
        flex: '0 0 auto',
        background: 'transparent',
        border: '1px solid var(--over)',
        color: 'var(--over)',
        transition: 'background 120ms ease',
      }}
    >
      Reset · Real Data
    </Link>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Per-state body content · Phase 32 (2026-05-28).
//
// Each state ships a real left + right pair built off the slim slices the
// page derives off GlanceState. The Sprint 03 placeholders are gone —
// every cell now renders concrete plan/health/race data with brand-voice
// prose. Reuses the canonical WorkoutBreakdown component so workout-
// structure SVGs are not duplicated.
//
// Doctrine references:
//   · Daniels Running Formula §VDOT-table-to-85 — pace bands + intensities
//   · LTHR auto-derivation — HR caps + ceilings
//   · Race-week protocol — RaceDayTimeline in /races/[slug]
// ──────────────────────────────────────────────────────────────────────

interface BodyContext {
  state: DayState;
  phaseLabel: string | null;
  todayDay: GlanceWeekDay | null;
  tomorrowDay: GlanceWeekDay | null;
  yesterdayDay: GlanceWeekDay | null;
  hrvCurrent: number | null;
  hrvBaseline: number | null;
  loadAcwr: number | null;
  rhrCurrent: number | null;
  rhrBaseline: number | null;
  sleep7Avg: number | null;
  daysToARace: number | null;
  nextARaceName: string | null;
  nextARaceSlug: string | null;
  runnerLthrBpm: number | null;
  activeNiggle: TodayClientProps['activeNiggle'];
  activeSick: TodayClientProps['activeSick'];
  posterChoice: PosterPayload['choice_row'];
}

function bodyHeadingFor(state: DayState): string {
  switch (state) {
    case 'easy':
    case 'quality':
    case 'long':
      return 'WORKOUT · THE BODY';
    case 'done_nailed':
    case 'done_ease_off':
      return "TODAY'S RUN · WHAT'S NEXT";
    case 'rest':
      return 'RECOVERY · THE BODY';
    case 'race_week':
      return 'RACE WEEK · THE DAY';
    case 'niggle':
      return 'NIGGLE · RECOVERY';
    case 'sick':
      return 'RECOVERY · PLAN STATUS';
    case 'skipped':
      return 'SKIPPED · TOMORROW';
    case 'missed':
      return 'MISSED · CATCH UP OR MOVE ON';
    default:
      return 'WORKOUT · THE BODY';
  }
}

function bodySuffixFor(state: DayState): string {
  switch (state) {
    case 'done_nailed':
    case 'done_ease_off':
    case 'race_week':
    case 'rest':
    case 'niggle':
    case 'sick':
    case 'missed':
    case 'skipped':
      return '';
    default:
      return 'today';
  }
}

function renderBodyLeft(ctx: BodyContext): ReactNode {
  const { state, todayDay, yesterdayDay, runnerLthrBpm } = ctx;
  switch (state) {
    case 'easy':
    case 'quality':
    case 'long': {
      const spec = todayDay?.plannedSpec ?? null;
      if (spec) {
        const wd = specToWorkoutDataLocal(spec, todayDay?.plannedMi ?? null);
        return (
          <WorkoutBreakdown
            data={wd}
            runnerLthrBpm={runnerLthrBpm ?? undefined}
          />
        );
      }
      return (
        <BCard header={{ label: 'WORKOUT BREAKDOWN' }} padding="tight">
          <PlanSummaryFallback day={todayDay} />
        </BCard>
      );
    }
    case 'done_nailed':
    case 'done_ease_off':
      return (
        <BCard
          header={{
            label: "TODAY'S RUN",
            value: todayDay?.doneMi ? `${todayDay.doneMi.toFixed(1)} mi` : undefined,
          }}
          padding="tight"
          footnote={
            todayDay?.activityId
              ? 'Splits + HR zones on the run detail surface.'
              : undefined
          }
        >
          <RunSummaryBlock day={todayDay} />
        </BCard>
      );
    case 'rest':
      return <HrvSummaryCard ctx={ctx} />;
    case 'sick':
      return (
        <BCard header={{ label: 'RETURN GATES' }} padding="tight">
          <SickGateBlock ctx={ctx} />
        </BCard>
      );
    case 'race_week':
      return <RaceCourseCard ctx={ctx} />;
    case 'niggle':
      return <NiggleHistoryCard ctx={ctx} />;
    case 'skipped': {
      const spec = todayDay?.plannedSpec ?? null;
      if (spec) {
        const wd = specToWorkoutDataLocal(spec, todayDay?.plannedMi ?? null);
        return (
          <WorkoutBreakdown
            data={wd}
            runnerLthrBpm={runnerLthrBpm ?? undefined}
          />
        );
      }
      return (
        <BCard
          header={{ label: 'WORKOUT YOU SKIPPED' }}
          padding="tight"
          footnote="One day off is not a derailment. The block continues."
        >
          <PlanSummaryFallback day={todayDay} />
        </BCard>
      );
    }
    case 'missed':
      return (
        <BCard
          header={{ label: 'YESTERDAY · MISSED' }}
          padding="tight"
          footnote="Choose to catch up or move on — either is doctrine-valid."
        >
          <PlanSummaryFallback day={yesterdayDay} />
        </BCard>
      );
    default:
      return null;
  }
}

function renderBodyRight(ctx: BodyContext): ReactNode {
  const { state, phaseLabel, todayDay, tomorrowDay } = ctx;
  switch (state) {
    case 'easy':
    case 'quality':
    case 'long':
      return (
        <BCard header={{ label: 'PHASE INTENT' }}>
          <PhaseIntentProse
            phaseLabel={phaseLabel}
            workoutType={todayDay?.plannedType ?? null}
            workoutMi={todayDay?.plannedMi ?? null}
            state={state}
          />
        </BCard>
      );
    case 'done_nailed':
    case 'done_ease_off':
      return (
        <BCard header={{ label: 'NEXT WORKOUT · TOMORROW' }}>
          <TomorrowBlock
            day={tomorrowDay}
            framing={state === 'done_ease_off' ? 'ease_off' : 'standard'}
          />
        </BCard>
      );
    case 'rest':
      return (
        <BCard header={{ label: 'TOMORROW' }}>
          <TomorrowBlock day={tomorrowDay} framing="rest_day" />
        </BCard>
      );
    case 'race_week':
      return <RaceTimelinePreviewCard ctx={ctx} />;
    case 'niggle':
      return (
        <BCard header={{ label: 'RECOVERY PLAN' }}>
          <NiggleRecoveryProse ctx={ctx} />
        </BCard>
      );
    case 'sick':
      return (
        <BCard header={{ label: 'PLAN STATUS' }}>
          <SickPlanStatus ctx={ctx} />
        </BCard>
      );
    case 'skipped':
      return (
        <BCard header={{ label: 'TOMORROW · FIRST STEP' }}>
          <TomorrowBlock day={tomorrowDay} framing="after_skip" />
        </BCard>
      );
    case 'missed':
      return (
        <BCard header={{ label: 'CATCH UP OR MOVE ON' }}>
          <MissedChoiceBlock ctx={ctx} />
        </BCard>
      );
    default:
      return null;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Helper subcomponents
// ──────────────────────────────────────────────────────────────────────

function PlanSummaryFallback({ day }: { day: GlanceWeekDay | null }) {
  if (!day) return <ProseRow>No workout authored for today.</ProseRow>;
  const distance = day.plannedMi > 0 ? `${day.plannedMi.toFixed(1)} mi` : null;
  const subLabel = day.plannedLabel ?? null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <StatLine label="TYPE" value={day.plannedType.toUpperCase()} />
      {distance && <StatLine label="DISTANCE" value={distance} />}
      {subLabel && <StatLine label="LABEL" value={subLabel} />}
      <ProseRow>
        Plan-spec sync pending · full breakdown chart returns once the
        plan-builder reauthors with VDOT.
      </ProseRow>
    </div>
  );
}

function RunSummaryBlock({ day }: { day: GlanceWeekDay | null }) {
  if (!day) return <ProseRow>No run logged today.</ProseRow>;
  const planned = day.plannedMi > 0 ? `${day.plannedMi.toFixed(1)} mi` : null;
  const done = day.doneMi > 0 ? `${day.doneMi.toFixed(1)} mi` : null;
  const delta = planned != null && done != null
    ? `${(day.doneMi - day.plannedMi).toFixed(1)} mi vs plan`
    : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <StatLine label="DONE" value={done ?? '—'} />
      {planned && <StatLine label="PLANNED" value={planned} />}
      {delta && <StatLine label="DELTA" value={delta} />}
      {day.activityId && (
        <div style={{ marginTop: 8 }}>
          <Link
            href={`/runs/${day.activityId}`}
            style={{
              display: 'inline-block',
              padding: '6px 12px',
              fontFamily: 'var(--f-body)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              textDecoration: 'none',
              borderRadius: 'var(--r-pill)',
              border: '1px solid var(--line)',
              background: 'var(--card2)',
              color: 'var(--ink)',
            }}
          >
            Splits · HR · detail →
          </Link>
        </div>
      )}
    </div>
  );
}

function HrvSummaryCard({ ctx }: { ctx: BodyContext }) {
  const { hrvCurrent, hrvBaseline } = ctx;
  if (hrvCurrent == null || hrvBaseline == null) {
    return (
      <BCard header={{ label: 'HRV' }} padding="tight">
        <ProseRow>
          No HRV reading yet · pair Apple Watch sleep tracking to populate.
        </ProseRow>
      </BCard>
    );
  }
  const delta = hrvCurrent - hrvBaseline;
  const sign = delta >= 0 ? '+' : '';
  const valueColor = delta >= 0 ? 'green' : 'amber';
  return (
    <BCard
      header={{
        label: 'HRV · TODAY',
        value: `${hrvCurrent} ms`,
        valueColor,
      }}
      padding="tight"
      footnote="14-day series wires once the time-series loader lands."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <StatLine label="BASELINE" value={`${hrvBaseline} ms`} />
        <StatLine label="DELTA" value={`${sign}${delta} ms`} />
        <ProseRow>
          HRV is the autonomic-nervous-system signal of recovery. Higher
          than baseline reads as adapted; lower reads as accumulated load.
        </ProseRow>
      </div>
    </BCard>
  );
}

function SickGateBlock({ ctx }: { ctx: BodyContext }) {
  const { activeSick, sleep7Avg, rhrCurrent, rhrBaseline } = ctx;
  if (!activeSick) return null;
  const SLEEP_TARGET = 7;
  const feverFree = !activeSick.has_fever;
  const sleepClear = sleep7Avg != null && sleep7Avg >= SLEEP_TARGET;
  const rhrClear =
    rhrCurrent != null && rhrBaseline != null && rhrCurrent - rhrBaseline <= 5;
  const gates = [
    { label: 'Fever-free for 24h', met: feverFree, tail: feverFree ? 'CLEAR' : 'fever on' },
    { label: `Slept ≥ ${SLEEP_TARGET}h last night`, met: sleepClear, tail: sleep7Avg != null ? `${sleep7Avg.toFixed(1)}h` : '—' },
    {
      label: 'RHR within 5 bpm of baseline',
      met: rhrClear,
      tail: rhrCurrent != null && rhrBaseline != null
        ? `${rhrCurrent - rhrBaseline >= 0 ? '+' : ''}${rhrCurrent - rhrBaseline} bpm`
        : '—',
    },
  ];
  const metCount = gates.filter((g) => g.met).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-body)',
        fontSize: 11, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: 1.2,
      }}>
        <span>3 gates needed</span>
        <span style={{ color: metCount === 3 ? 'var(--green)' : 'var(--mute)' }}>{metCount}/3</span>
      </div>
      {gates.map((g, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: 10, alignItems: 'center' }}>
          <div style={{
            width: 18, height: 18, borderRadius: '50%',
            background: g.met ? 'var(--green)' : 'var(--line-2)',
            border: g.met ? 'none' : '1px solid var(--line)',
            color: '#0a0c10', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800,
          }}>{g.met ? '✓' : ''}</div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: g.met ? 'var(--ink)' : 'var(--mute)' }}>{g.label}</div>
          <div style={{
            fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
            color: g.met ? 'var(--green)' : 'var(--mute)', textTransform: 'uppercase',
          }}>{g.tail}</div>
        </div>
      ))}
    </div>
  );
}

function RaceCourseCard({ ctx }: { ctx: BodyContext }) {
  const { nextARaceName, nextARaceSlug, daysToARace } = ctx;
  if (!nextARaceName) {
    return (
      <BCard header={{ label: 'RACE WEEK' }} padding="tight">
        <ProseRow>No A-race attached. Add one on /races to unlock the timeline.</ProseRow>
      </BCard>
    );
  }
  const dayLabel =
    daysToARace == null ? '' :
    daysToARace === 0 ? 'today' :
    daysToARace === 1 ? 'tomorrow' :
    `in ${daysToARace} days`;
  return (
    <BCard
      header={{ label: 'RACE DETAIL', value: dayLabel || undefined, valueColor: 'race' }}
      padding="tight"
      footnote={nextARaceSlug ? `Course · pace plan · checklist live on /races/${nextARaceSlug}.` : undefined}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <StatLine label="RACE" value={nextARaceName} />
        {daysToARace != null && <StatLine label="COUNTDOWN" value={`T-${daysToARace}`} />}
        <ProseRow>
          Course, pace plan, and the 9-moment race-day timeline live on the
          race detail surface. Tap through for the checklist + start-corral
          logistics.
        </ProseRow>
        {nextARaceSlug && (
          <div style={{ marginTop: 4 }}>
            <Link
              href={`/races/${nextARaceSlug}`}
              style={{
                display: 'inline-block', padding: '6px 12px',
                fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700,
                letterSpacing: 0.4, textTransform: 'uppercase', textDecoration: 'none',
                borderRadius: 'var(--r-pill)', border: '1px solid var(--race)',
                background: 'rgba(255,136,71,0.08)', color: 'var(--race)',
              }}
            >Open race →</Link>
          </div>
        )}
      </div>
    </BCard>
  );
}

function RaceTimelinePreviewCard({ ctx }: { ctx: BodyContext }) {
  const { nextARaceName, nextARaceSlug, daysToARace } = ctx;
  const moments: Array<{ label: string; sub: string }> = [
    { label: 'NIGHT BEFORE', sub: 'Sleep · lay out kit' },
    { label: 'RACE MORNING', sub: 'Eat early · caffeine' },
    { label: 'START LINE', sub: 'Settle into pace' },
    { label: 'HALFWAY', sub: 'Trust the plan' },
    { label: 'FINISH', sub: 'Empty the tank' },
  ];
  return (
    <BCard
      header={{ label: 'RACE-DAY TIMELINE' }}
      padding="tight"
      footnote="The full 9-moment timeline opens on the race detail page."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {moments.map((m, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10,
            padding: '6px 0',
            borderBottom: i < moments.length - 1 ? '1px solid var(--line)' : 'none',
          }}>
            <div style={{
              fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, letterSpacing: 1,
              color: i === 0 && daysToARace != null && daysToARace > 1 ? 'var(--race)' : 'var(--mute)',
              textTransform: 'uppercase', minWidth: 110,
            }}>{m.label}</div>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--ink)' }}>{m.sub}</div>
          </div>
        ))}
      </div>
      {nextARaceSlug && (
        <div style={{ marginTop: 12 }}>
          <Link href={`/races/${nextARaceSlug}`} style={{
            display: 'inline-block', padding: '6px 12px',
            fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700,
            letterSpacing: 0.4, textTransform: 'uppercase', textDecoration: 'none',
            borderRadius: 'var(--r-pill)', border: '1px solid var(--line)',
            background: 'var(--card2)', color: 'var(--ink)',
          }}>Open full timeline →</Link>
        </div>
      )}
      {!nextARaceName && <ProseRow>Attach an A-race on /races to unlock the timeline.</ProseRow>}
    </BCard>
  );
}

function NiggleHistoryCard({ ctx }: { ctx: BodyContext }) {
  const { activeNiggle } = ctx;
  if (!activeNiggle) return null;
  const body = activeNiggle.body_part.replace(/_/g, ' ');
  const side = activeNiggle.side && activeNiggle.side !== 'both'
    ? `${activeNiggle.side} ${body}` : body;
  const statusLabel = activeNiggle.status === 'just_started' ? 'Just started'
    : activeNiggle.status === 'few_days' ? 'A few days' : 'Weeks now';
  return (
    <BCard
      header={{ label: 'ACTIVE NIGGLE', value: `${activeNiggle.days_active}d` }}
      padding="tight"
      footnote={activeNiggle.days_active >= 7
        ? 'Past day 7 · clinical input recommended.'
        : 'Log status changes via BETTER / SAME / WORSE / GONE above.'}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <StatLine label="BODY PART" value={side.toUpperCase()} />
        <StatLine label="SEVERITY" value={`${activeNiggle.severity}/10`} />
        <StatLine label="STATUS" value={statusLabel} />
        <StatLine label="LOGGED" value={new Date(activeNiggle.logged_at).toISOString().slice(0, 10)} />
      </div>
    </BCard>
  );
}

function NiggleRecoveryProse({ ctx }: { ctx: BodyContext }) {
  const { activeNiggle, tomorrowDay } = ctx;
  if (!activeNiggle) return null;
  const tomorrowMi = tomorrowDay?.plannedMi ?? 0;
  const reducedMi = tomorrowMi > 0 ? Math.max(1, Math.round(tomorrowMi * 0.5)) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ProseRow>
        {tomorrowMi > 0
          ? `Tomorrow tries ${reducedMi} easy at HR cap 138 — half the planned ${tomorrowMi.toFixed(0)} so the body can tick over without flaring.`
          : 'Tomorrow stays rest until the niggle settles.'}
      </ProseRow>
      {activeNiggle.days_active >= 7 && (
        <div style={{
          background: 'rgba(252,77,100,0.08)',
          border: '1px solid rgba(252,77,100,0.32)',
          borderRadius: 12, padding: '10px 12px',
        }}>
          <div style={{
            fontFamily: 'var(--f-display)', fontWeight: 700, letterSpacing: '-0.015em',
            fontSize: 14, color: 'var(--over)', marginBottom: 4,
          }}>Consider seeing a physio.</div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, lineHeight: 1.45, color: 'var(--ink)' }}>
            Day {activeNiggle.days_active + 1}. Past day 7 is where coach
            guidance ends and clinical input begins.
          </div>
        </div>
      )}
    </div>
  );
}

function SickPlanStatus({ ctx }: { ctx: BodyContext }) {
  const { activeSick } = ctx;
  if (!activeSick) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <StatLine label="STATUS" value="Plan paused" />
      <StatLine label="DAYS PAUSED" value={`${activeSick.days_active}d`} />
      <ProseRow>
        Resumes at easy when all three return gates clear. Recovery beats
        adherence in the illness window.
      </ProseRow>
    </div>
  );
}

function MissedChoiceBlock({ ctx }: { ctx: BodyContext }) {
  const { posterChoice, todayDay, yesterdayDay } = ctx;
  const recommended = posterChoice?.recommended ?? 'move_on';
  const yesterdayLabel = yesterdayDay?.plannedLabel
    ?? (yesterdayDay?.plannedMi
      ? `${yesterdayDay.plannedMi.toFixed(1)} mi ${yesterdayDay.plannedType}`
      : "yesterday's session");
  const todayLabel = todayDay?.plannedLabel
    ?? (todayDay?.plannedMi
      ? `${todayDay.plannedMi.toFixed(1)} mi ${todayDay.plannedType}`
      : "today's session");
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ProseRow>
        {recommended === 'catch_up'
          ? `Catching up keeps the block intact. The miss was small — ${yesterdayLabel} fits into today's window.`
          : `Moving on protects today. The miss is over — today's ${todayLabel} stays as-is.`}
      </ProseRow>
      <StatLine label="RECOMMENDED" value={recommended.replace('_', ' ').toUpperCase()} />
      <ProseRow>
        Choose on the poster. Either is doctrine-valid — protocols pick
        based on the week's remaining volume + load.
      </ProseRow>
    </div>
  );
}

function PhaseIntentProse({
  phaseLabel, workoutType, workoutMi, state,
}: {
  phaseLabel: string | null;
  workoutType: string | null;
  workoutMi: number | null;
  state: DayState;
}) {
  const phase = phaseLabel?.split('·')[0].trim() || phaseLabel || 'Build';
  const typeLabel = (workoutType ?? '').toUpperCase();
  let body: string;
  switch (state) {
    case 'easy':
      body = `${phase} phase · easy days bank aerobic volume without taxing the system. Hold conversational pace, stay under the HR ceiling, let the legs come home rested.`;
      break;
    case 'long':
      body = `${phase} phase · the long run builds glycogen capacity and time-on-feet endurance. Pace stays in the aerobic band; the value is the duration, not the speed.`;
      break;
    case 'quality':
      body = `${phase} phase · quality sessions sit at threshold or interval intensity. The work block is the dose; warmup and cooldown frame it. Hold the prescribed pace — overrunning quality costs the rest of the week.`;
      break;
    default:
      body = `${phase} phase.`;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ProseRow>{body}</ProseRow>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {phaseLabel && <Chip>{phaseLabel}</Chip>}
        {typeLabel && <Chip>{typeLabel}</Chip>}
        {workoutMi != null && workoutMi > 0 && <Chip>{`${workoutMi.toFixed(1)} mi`}</Chip>}
      </div>
    </div>
  );
}

function TomorrowBlock({
  day, framing,
}: {
  day: GlanceWeekDay | null;
  framing: 'standard' | 'rest_day' | 'ease_off' | 'after_skip';
}) {
  if (!day) return <ProseRow>No plan for tomorrow yet.</ProseRow>;
  if (day.plannedType === 'rest' || day.plannedMi === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <StatLine label="TYPE" value="REST" />
        <ProseRow>
          {framing === 'after_skip'
            ? 'Tomorrow is rest. Two days off is a longer break than the plan wants — ease back in the day after.'
            : 'Tomorrow is rest. Full recovery day — sleep, eat, walk.'}
        </ProseRow>
      </div>
    );
  }
  const distance = day.plannedMi.toFixed(1);
  const subLabel = day.plannedLabel ?? null;
  let proseLead: string;
  switch (framing) {
    case 'rest_day':
      proseLead = `Tomorrow returns to ${distance} mi ${day.plannedType}.`;
      break;
    case 'ease_off':
      proseLead = `Tomorrow eases off to ${distance} mi ${day.plannedType} — today went big, so recovery is the priority.`;
      break;
    case 'after_skip':
      proseLead = `Ready when you are — tomorrow is ${distance} mi ${day.plannedType}.`;
      break;
    default:
      proseLead = `Tomorrow is ${distance} mi ${day.plannedType}.`;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <StatLine label="TYPE" value={day.plannedType.toUpperCase()} />
      <StatLine label="DISTANCE" value={`${distance} mi`} />
      {subLabel && <StatLine label="LABEL" value={subLabel} />}
      <ProseRow>{proseLead}</ProseRow>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Small inline UI primitives
// ──────────────────────────────────────────────────────────────────────

function StatLine({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700,
        letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--mute)',
      }}>{label}</span>
      <span style={{
        fontFamily: 'var(--f-body)', fontSize: 13, fontWeight: 600,
        color: 'var(--ink)', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
      }}>{value}</span>
    </div>
  );
}

function ProseRow({ children }: { children: ReactNode }) {
  return (
    <p style={{
      margin: 0, fontFamily: 'var(--f-body)', fontSize: 12,
      lineHeight: 1.5, color: 'var(--ink)',
    }}>{children}</p>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span style={{
      padding: '3px 8px', fontFamily: 'var(--f-body)', fontSize: 9,
      fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
      color: 'var(--mute)', background: 'var(--card2)',
      border: '1px solid var(--line)', borderRadius: 'var(--r-pill)',
    }}>{children}</span>
  );
}

// ──────────────────────────────────────────────────────────────────────
// WorkoutSpec (DB JSONB) → WorkoutData. Mirror of /runs/[id] spec adapter.
// ──────────────────────────────────────────────────────────────────────
function specToWorkoutDataLocal(
  spec: WorkoutSpec,
  fallbackDistanceMi: number | null,
): WorkoutData {
  switch (spec.kind) {
    case 'easy':
      return {
        type: 'easy',
        distance_mi: fallbackDistanceMi ?? 0,
        pace_target: {
          s: Math.round((spec.pace_target_s_per_mi_lo + spec.pace_target_s_per_mi_hi) / 2),
          band: [spec.pace_target_s_per_mi_lo, spec.pace_target_s_per_mi_hi],
        },
        hr_cap: spec.hr_cap_bpm,
      };
    case 'long':
      return {
        type: 'long',
        distance_mi: fallbackDistanceMi ?? 0,
        pace_band: [spec.pace_target_s_per_mi_lo, spec.pace_target_s_per_mi_hi],
        fuel_checkpoints_mi: spec.fuel_mi,
      };
    case 'threshold':
    case 'intervals':
      return {
        type: 'intervals',
        warmup_mi: spec.warmup_mi,
        reps: spec.rep_count,
        rep_distance_m: spec.rep_distance_m
          ?? (spec.rep_distance_mi ? Math.round(spec.rep_distance_mi * 1609) : 1000),
        rep_pace_s_per_mi: spec.rep_pace_s_per_mi,
        rest_jog_s: spec.rep_rest_s,
        cooldown_mi: spec.cooldown_mi,
      };
    case 'tempo':
      return {
        type: 'tempo',
        warmup_mi: spec.warmup_mi,
        tempo_distance_mi: spec.tempo_distance_mi,
        tempo_pace_s_per_mi: spec.tempo_pace_s_per_mi,
        cooldown_mi: spec.cooldown_mi,
      };
    case 'progression':
      return {
        type: 'progression',
        total_mi: spec.warmup_mi + spec.prog_distance_mi + spec.cooldown_mi,
        start_pace_s_per_mi: spec.prog_start_s_per_mi,
        end_pace_s_per_mi: spec.prog_end_s_per_mi,
        phase_breakpoints_mi: [spec.warmup_mi, spec.warmup_mi + spec.prog_distance_mi],
      };
    case 'recovery':
      return {
        type: 'easy',
        distance_mi: fallbackDistanceMi ?? 0,
        pace_target: {
          s: Math.round((spec.pace_target_s_per_mi_lo + spec.pace_target_s_per_mi_hi) / 2),
          band: [spec.pace_target_s_per_mi_lo, spec.pace_target_s_per_mi_hi],
        },
        hr_cap: spec.hr_cap_bpm,
      };
    case 'mp':
      return {
        type: 'tempo',
        warmup_mi: spec.warmup_mi,
        tempo_distance_mi: spec.mp_distance_mi,
        tempo_pace_s_per_mi: spec.mp_pace_s_per_mi,
        cooldown_mi: spec.cooldown_mi,
      };
    case 'fartlek':
      return {
        type: 'hills',
        warmup_mi: spec.warmup_mi,
        reps: spec.segments.length,
        hill_distance_m: 0,
        hill_grade_pct: 0,
        recovery_s: 0,
        cooldown_mi: spec.cooldown_mi,
      };
    default: {
      const _exhaustive: never = spec;
      void _exhaustive;
      return {
        type: 'easy',
        distance_mi: fallbackDistanceMi ?? 0,
        pace_target: { s: 0, band: [0, 0] },
        hr_cap: null,
      };
    }
  }
}
