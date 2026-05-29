'use client';

/**
 * VerbHero · the verb-as-mood-ring hero, FAFF technical spec-sheet language.
 * Paper-overhaul 2026-05-29 (docs/DESIGN_OVERHAUL_2026-05-29.md §5).
 *
 * Replaces the gradient Poster on /today. Same PosterPayload contract, new
 * composition: color is a REGISTRATION MARK (accent bar + status dot +
 * bracket), never a gradient fill. The VERB carries all personality; the
 * numbers below carry none (no prose — locked decision).
 *
 * Renders, top→bottom:
 *   · eyebrow row — [ STATE ] bracket + skip/undo chip
 *   · accent bar + giant VERB (or hero_number / days_countdown)
 *   · workout_breakdown spec rows (when present)
 *   · choice_row (missed) — catch up / move on
 *   · stat_trio instrument readout
 * Wrapped in CropFrame registration marks.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PosterPayload, DayState } from '@/lib/faff/types';
import { CropFrame, RegistrationDot, Stamp, SpecLabel, toneColor, type StatusTone } from './graphic';

const SKIP_ELIGIBLE = new Set<DayState>(['easy', 'quality', 'long']);

// State → registration tone (the accent bar + dot color).
const STATE_TONE: Record<DayState, StatusTone> = {
  easy: 'green',
  quality: 'amber',
  long: 'dist',
  rest: 'rest',
  done_nailed: 'green',
  done_ease_off: 'amber',
  niggle: 'amber',
  sick: 'over',
  missed: 'amber',
  race_week: 'race',
  new_user: 'learn',
  skipped: 'mute',
};

export function VerbHero({ payload }: { payload: PosterPayload }) {
  const router = useRouter();
  const [skipPending, setSkipPending] = useState(false);
  const tone = STATE_TONE[payload.state] ?? 'mute';
  const accent = toneColor(tone);

  const showSkip = SKIP_ELIGIBLE.has(payload.state);
  const showUndo = payload.state === 'skipped';

  const onSkipToggle = async (mode: 'skip' | 'undo') => {
    if (skipPending) return;
    setSkipPending(true);
    try {
      await fetch('/api/today/skip', {
        method: mode === 'skip' ? 'POST' : 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      router.refresh();
    } catch (err) {
      console.error('[verb-hero] skip toggle failed:', err);
    } finally {
      setSkipPending(false);
    }
  };

  return (
    <CropFrame
      inset={6}
      tone="mute"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 16,
        boxShadow: 'var(--shadow-panel)',
        padding: '26px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {/* eyebrow row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <RegistrationDot tone={tone} size={9} ring />
          <SpecLabel style={{ color: 'var(--ink)', letterSpacing: '2px' }}>{payload.eyebrow}</SpecLabel>
        </span>
        {showSkip && (
          <SkipButton pending={skipPending} onClick={() => onSkipToggle('skip')}>SKIP TODAY</SkipButton>
        )}
        {showUndo && (
          <SkipButton pending={skipPending} onClick={() => onSkipToggle('undo')}>UNDO SKIP</SkipButton>
        )}
      </div>

      {/* verb / hero_number with accent bar */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 18 }}>
        <span aria-hidden style={{ width: 6, borderRadius: 3, background: accent, flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          {payload.hero_number ? (
            <HeroNumber heroNumber={payload.hero_number} />
          ) : payload.days_countdown ? (
            <DaysCountdown dc={payload.days_countdown} accent={accent} />
          ) : (
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--f-display)',
                fontWeight: 700,
                fontSize: 'clamp(46px, 9vw, 92px)',
                lineHeight: 0.86,
                letterSpacing: '-0.02em',
                color: 'var(--ink)',
                textTransform: 'uppercase',
              }}
            >
              {payload.verb}
              {payload.verb_suffix && (
                <span style={{ display: 'block', fontSize: '0.34em', letterSpacing: '0.04em', color: 'var(--mute)', marginTop: 8, fontWeight: 700 }}>
                  {payload.verb_suffix}
                </span>
              )}
            </h1>
          )}
          {payload.phase_tag && (
            <div style={{ marginTop: 10 }}>
              <Stamp tone={tone}>{payload.phase_tag}</Stamp>
            </div>
          )}
        </div>
      </div>

      {/* workout breakdown spec rows */}
      {payload.workout_breakdown && payload.workout_breakdown.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--line)' }}>
          {payload.workout_breakdown.map((row, i) => (
            <div
              key={`${row.label}-${i}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '92px 1fr auto',
                gap: 14,
                alignItems: 'baseline',
                padding: '10px 0',
                borderBottom: i < payload.workout_breakdown!.length - 1 ? '1px solid var(--line-2)' : 'none',
              }}
            >
              <SpecLabel>{row.label}</SpecLabel>
              <span style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink)', lineHeight: 1.4 }}>{row.body}</span>
              {row.tail !== null && (
                <span className="tabular" style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>
                  {row.tail}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* missed → catch up / move on */}
      {payload.choice_row && <ChoiceRow row={payload.choice_row} accent={accent} />}

      {/* stat trio instrument readout */}
      {payload.stat_trio && payload.stat_trio.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 0,
            borderTop: '1px solid var(--line)',
            paddingTop: 14,
          }}
        >
          {payload.stat_trio.map((s, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: i > 0 ? 16 : 0, borderLeft: i > 0 ? '1px solid var(--line-2)' : 'none' }}>
              <span
                className="tabular"
                style={{
                  fontFamily: 'var(--f-display)',
                  fontWeight: 700,
                  fontSize: 24,
                  letterSpacing: '-0.01em',
                  color: s.valueColor && s.valueColor !== 'default' ? valueColorVar(s.valueColor) : 'var(--ink)',
                }}
              >
                {s.value}
              </span>
              <SpecLabel>{s.label}</SpecLabel>
            </div>
          ))}
        </div>
      )}
    </CropFrame>
  );
}

function valueColorVar(c: string): string {
  switch (c) {
    case 'amber': return 'var(--goal)';
    case 'green': return 'var(--green)';
    case 'over': return 'var(--over)';
    case 'race': return 'var(--race)';
    case 'dist': return 'var(--dist)';
    default: return 'var(--ink)';
  }
}

function HeroNumber({ heroNumber }: { heroNumber: NonNullable<PosterPayload['hero_number']> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
      <span
        className="tabular"
        style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 'clamp(56px, 11vw, 104px)', lineHeight: 0.82, letterSpacing: '-0.02em', color: 'var(--ink)' }}
      >
        {heroNumber.value}
      </span>
      {heroNumber.unit && <span style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 28, color: 'var(--mute)', textTransform: 'uppercase' }}>{heroNumber.unit}</span>}
      {heroNumber.duration && <span style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'var(--mute)' }}>~{heroNumber.duration}</span>}
    </div>
  );
}

function DaysCountdown({ dc, accent }: { dc: NonNullable<PosterPayload['days_countdown']>; accent: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
      <span className="tabular" style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 'clamp(56px, 11vw, 104px)', lineHeight: 0.82, letterSpacing: '-0.02em', color: accent }}>
        {dc.days}
      </span>
      <span style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 30, color: 'var(--ink)', textTransform: 'uppercase' }}>
        {dc.days === 1 ? 'DAY' : 'DAYS'}
      </span>
      <span style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'var(--mute)', letterSpacing: '1px' }}>{dc.dateLabel}</span>
    </div>
  );
}

function ChoiceRow({ row, accent }: { row: NonNullable<PosterPayload['choice_row']>; accent: string }) {
  const btn = (side: 'left' | 'right') => {
    const data = side === 'left' ? row.left : row.right;
    const action = side === 'left' ? 'catch_up' : 'move_on';
    const recommended = row.recommended === action;
    return (
      <button
        type="button"
        data-action={action}
        style={{
          flex: 1,
          textAlign: 'left',
          background: recommended ? `color-mix(in srgb, ${accent} 10%, transparent)` : 'transparent',
          border: `1px solid ${recommended ? accent : 'var(--line)'}`,
          borderRadius: 10,
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        <span style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em', color: recommended ? accent : 'var(--ink)', textTransform: 'uppercase' }}>{data.label}</span>
        <span style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)' }}>{data.sub}</span>
      </button>
    );
  };
  return <div style={{ display: 'flex', gap: 12, borderTop: '1px solid var(--line)', paddingTop: 14 }}>{btn('left')}{btn('right')}</div>;
}

function SkipButton({ children, pending, onClick }: { children: React.ReactNode; pending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      style={{
        fontFamily: 'var(--f-label)',
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        color: 'var(--mute)',
        background: 'transparent',
        border: '1px solid var(--line)',
        borderRadius: 3,
        padding: '4px 9px',
        cursor: pending ? 'default' : 'pointer',
        opacity: pending ? 0.5 : 1,
      }}
    >
      {pending ? '…' : children}
    </button>
  );
}
