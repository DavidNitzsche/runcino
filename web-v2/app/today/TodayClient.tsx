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
import type { PosterPayload, SiblingPayload, WeekStripPayload, DayState } from '@/lib/faff/types';
import { PERSONA_CATALOGUE, type PersonaKey } from '@/lib/faff/personas';
import { Poster } from '@/components/faff/Poster';
import { Sibling } from '@/components/faff/Sibling';
import { WeekStrip } from '@/components/faff/WeekStrip';
import { BodyGrid } from '@/components/faff/BodyGrid';
import { BCard } from '@/components/faff/BCard';

export interface TodayClientProps {
  poster: PosterPayload;
  sibling: SiblingPayload;
  week: WeekStripPayload;
  state: DayState;
  phaseLabel: string | null;
  // Slots: the page wires the legacy briefing + readiness loaders here so
  // we can keep them rendering while the new shell takes over visually.
  briefingSlot?: ReactNode;
  errorSlot?: ReactNode;
  // Simulator mode · non-null when /today?persona=<key> is on the URL.
  activePersona?: PersonaKey | null;
}

export function TodayClient({
  poster,
  sibling,
  week,
  state,
  phaseLabel,
  briefingSlot,
  errorSlot,
  activePersona,
}: TodayClientProps) {
  const phaseHeader = phaseLabel ? phaseLabel.toUpperCase() : undefined;
  const activeEntry = activePersona
    ? PERSONA_CATALOGUE.find((p) => p.key === activePersona) ?? null
    : null;

  return (
    <main style={{ minHeight: '100vh', paddingBottom: 80 }}>
      {/* SIMULATOR BAR · only renders in persona mode. Banner + chip strip. */}
      {activeEntry && (
        <SimulatorBar activeKey={activeEntry.key} description={activeEntry.description} label={activeEntry.label} />
      )}

      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '32px 32px 0' }}>
        {/* HERO · Poster + Sibling side-by-side · single column on mobile */}
        <div
          className="today-hero"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            marginBottom: 24,
          }}
        >
          <Poster payload={poster} />
          <Sibling payload={sibling} />
        </div>

        {/* WEEK STRIP */}
        {week.days.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <WeekStrip payload={week} phaseLabel={phaseHeader} />
          </div>
        )}

        {/* COACH VOICE (LLM-backed) — kept from production while we migrate
            the deterministic voice into the Sibling. Renders into a clean
            BCard so it blends with the new visual system. In simulator
            mode the slot is a static placeholder (LLM disabled). */}
        {briefingSlot && (
          <div style={{ marginBottom: 24 }}>
            <BCard header={{ label: 'COACH · WHY THIS WORKOUT' }}>
              {briefingSlot}
            </BCard>
          </div>
        )}

        {/* BODY GRID · per-state body content (placeholders until Sprint 03
            fully wires the per-state right column to real plan + health data).
            P-SKIP 2026-05-28: hide on `skipped` too — there's no workout to
            unpack and the body tiles live on the Sibling already. */}
        {state !== 'new_user' && state !== 'missed' && state !== 'skipped' && (
          <BodyGrid
            sectionHeading="WORKOUT · THE BODY"
            sectionSuffix="today"
            left={renderBodyLeft(state)}
            right={renderBodyRight(state)}
          />
        )}

        {errorSlot}
      </div>

      {/* Mobile single-column hero */}
      <style>{`
        @media (max-width: 899px) {
          .today-hero { grid-template-columns: 1fr !important; }
        }
        .persona-chip-strip::-webkit-scrollbar { display: none; }
        .persona-chip-strip { scrollbar-width: none; }
        .persona-chip:hover { background: rgba(255,255,255,0.05) !important; }
        .persona-chip-active:hover { filter: brightness(1.08); }
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
// Per-state body content. v1 stubs — Sprint 03 wires real data per
// design/pages/today.md table.
// ──────────────────────────────────────────────────────────────────────

function renderBodyLeft(state: DayState): ReactNode {
  switch (state) {
    case 'easy':
    case 'quality':
    case 'long':
      return (
        <BCard header={{ label: 'WORKOUT BREAKDOWN' }} padding="tight">
          <Placeholder>Breakdown chart wires here · Sprint 03.</Placeholder>
        </BCard>
      );
    case 'done_nailed':
    case 'done_ease_off':
      return (
        <BCard header={{ label: 'MILE SPLITS' }} padding="tight">
          <Placeholder>Splits chart from this run · Sprint 03.</Placeholder>
        </BCard>
      );
    case 'rest':
    case 'sick':
      return (
        <BCard header={{ label: 'HRV · 14 DAYS' }} padding="tight">
          <Placeholder>HRV trend chart · Sprint 03.</Placeholder>
        </BCard>
      );
    case 'race_week':
      return (
        <BCard header={{ label: 'RACE COURSE' }} padding="tight">
          <Placeholder>Course map · Sprint 03.</Placeholder>
        </BCard>
      );
    default:
      return null;
  }
}

function renderBodyRight(state: DayState): ReactNode {
  switch (state) {
    case 'easy':
    case 'quality':
    case 'long':
      return (
        <BCard header={{ label: 'PHASE INTENT' }}>
          <Placeholder>
            Why this workout sits inside the phase · Sprint 03.
          </Placeholder>
        </BCard>
      );
    case 'done_nailed':
    case 'done_ease_off':
      return (
        <BCard header={{ label: 'NEXT WORKOUT · TOMORROW' }}>
          <Placeholder>Tomorrow's prescription · Sprint 03.</Placeholder>
        </BCard>
      );
    case 'rest':
      return (
        <BCard header={{ label: 'TOMORROW' }}>
          <Placeholder>Tomorrow's prescription · Sprint 03.</Placeholder>
        </BCard>
      );
    case 'race_week':
      return (
        <BCard header={{ label: 'CHECKLIST' }}>
          <Placeholder>Race-week checklist · Sprint 03.</Placeholder>
        </BCard>
      );
    default:
      return null;
  }
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--f-body)',
        fontSize: 12,
        color: 'var(--mute)',
        padding: '12px 4px',
        letterSpacing: '0.2px',
      }}
    >
      {children}
    </div>
  );
}
