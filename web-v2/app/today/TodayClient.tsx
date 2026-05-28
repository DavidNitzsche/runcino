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
 * Cardinal Rule #1: don't break what works. BriefingLoader, TopNav,
 * ReadinessChipTrigger keep their existing roles unchanged.
 */

import type { ReactNode } from 'react';
import type { PosterPayload, SiblingPayload, WeekStripPayload, DayState } from '@/lib/faff/types';
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
}

export function TodayClient({
  poster,
  sibling,
  week,
  state,
  phaseLabel,
  briefingSlot,
  errorSlot,
}: TodayClientProps) {
  const phaseHeader = phaseLabel ? phaseLabel.toUpperCase() : undefined;

  return (
    <main style={{ minHeight: '100vh', paddingBottom: 80 }}>
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
            BCard so it blends with the new visual system. */}
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
      `}</style>
    </main>
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
