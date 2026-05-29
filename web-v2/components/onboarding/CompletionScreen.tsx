/**
 * Completion screen · Lilian onboarding.
 *
 * Deck source: docs/2026-05-28-onboarding-lilian.html § COMPLETION.
 *
 * Done gradient (g-done) plus a mini-poster preview of tomorrow's
 * first workout. We don't reach into the real plan engine here — the
 * preview shows a sensible default for whatever distance + race date
 * the runner just locked in. The "first day" detail will lift from
 * the resolver once /today is opened.
 */

import Link from 'next/link';
import type { OnboardingState } from '@/lib/onboarding/state';
import { distanceLabel } from '@/lib/onboarding/state';

export function CompletionScreen({ state }: { state: OnboardingState }) {
  const sub = state.distance === 'none' || !state.date
    ? 'Your first day is ready.'
    : `${distanceLabel(state.distance)} plan around ${formatRaceDate(state.date)}. First day below — head to /today when you're ready.`;

  const tomorrow = computeTomorrow();
  const daysToRace = state.date ? daysUntil(state.date) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: '2.2px',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.85)',
        marginBottom: 18,
      }}>
        YOUR PLAN IS BUILT
      </div>

      <div style={{ marginTop: 50 }} />

      <h1 style={{
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        lineHeight: 0.86,
        fontSize: 'clamp(72px, 13vw, 132px)',
        margin: 0,
        color: '#fff',
        textTransform: 'uppercase',
      }}>
        YOU'RE IN.
      </h1>

      <p style={{
        fontFamily: 'var(--f-body)',
        fontSize: 17,
        lineHeight: 1.55,
        color: 'rgba(255,255,255,0.86)',
        margin: '24px 0 0',
        maxWidth: 520,
      }}>
        {sub}
      </p>

      {/* Mini-poster · tomorrow's first workout. Not pulled from the
       *  real resolver yet — it'll lift on next visit to /today.
       *  Per CLAUDE.md note (b) in the report, this is a "fudge"
       *  because the plan engine doesn't generate from onboarding yet. */}
      <div style={{
        background: 'rgba(0,0,0,0.28)',
        borderRadius: 16,
        padding: '16px 18px',
        marginTop: 22,
        maxWidth: 480,
      }}>
        <div style={{
          fontFamily: 'var(--f-body)',
          fontWeight: 700,
          fontSize: 9,
          letterSpacing: '1.6px',
          textTransform: 'uppercase',
          color: 'rgba(255,255,255,0.65)',
          marginBottom: 6,
        }}>
          TOMORROW · {tomorrow.weekday.toUpperCase()} · {tomorrow.dateLabel.toUpperCase()}
        </div>
        <div style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          letterSpacing: '-0.015em',
          lineHeight: 0.86,
          fontSize: 38,
          color: '#fff',
          marginBottom: 12,
        }}>
          EASY 4.0.
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          paddingTop: 12,
          borderTop: '1px solid rgba(255,255,255,0.15)',
        }}>
          <Stat value="8:45" unit="/mi" label="PACE" />
          <Stat value="~35m" label="EST. TIME" />
          {daysToRace != null
            ? <Stat value={`${daysToRace}d`} label="TO RACE" />
            : <Stat value="—" label="WEEKLY" />}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <Link
        href="/today"
        style={{
          background: '#fff',
          color: '#0c2a5e',
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          letterSpacing: '-0.015em',
          fontSize: 22,
          padding: 18,
          borderRadius: 16,
          textAlign: 'center',
          textTransform: 'uppercase',
          textDecoration: 'none',
          display: 'block',
          maxWidth: 480,
          marginTop: 32,
        }}
      >
        Go to Today
      </Link>
    </div>
  );
}

function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div>
      <div style={{
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        fontSize: 24,
        color: '#fff',
        fontFeatureSettings: '"tnum"',
        lineHeight: 1,
      }}>
        {value}
        {unit && (
          <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>{unit}</span>
        )}
      </div>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '1.4px',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.7)',
        marginTop: 5,
      }}>
        {label}
      </div>
    </div>
  );
}

function computeTomorrow(): { weekday: string; dateLabel: string } {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return {
    weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
    dateLabel: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  };
}

function formatRaceDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function daysUntil(iso: string): number | null {
  const target = new Date(iso + 'T00:00:00');
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const ms = target.getTime() - now.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 86400000));
}
