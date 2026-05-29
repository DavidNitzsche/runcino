/**
 * Step 1 · Goal · Lilian onboarding.
 *
 * Deck source: docs/2026-05-28-onboarding-lilian.html § STEP 1 · GOAL.
 *
 * Distance picker (5K · 10K · Half · Marathon · No specific race) →
 * conditional secondary inputs (race date required, goal time optional)
 * → "Continue". When "No specific race" is picked, the secondary inputs
 * are replaced by the consistency callout.
 */

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  buildOnboardingHref,
  canAdvanceFromGoal,
  type OnboardingState,
  type RaceDistance,
} from '@/lib/onboarding/state';

const DISTANCES: { value: RaceDistance; label: string; wide?: boolean }[] = [
  { value: '5k',       label: '5K' },
  { value: '10k',      label: '10K' },
  { value: 'half',     label: 'Half' },
  { value: 'marathon', label: 'Marathon' },
  { value: 'none',     label: 'No specific race', wide: true },
];

export function Step1Goal({ initial }: { initial: OnboardingState }) {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>(initial);

  const canAdvance = canAdvanceFromGoal(state);
  const showRaceInputs = state.distance && state.distance !== 'none';
  const showConsistencyCallout = state.distance === 'none';

  function pick(d: RaceDistance) {
    // Clear date/time when leaving race mode for no-race mode.
    const next: OnboardingState = d === 'none'
      ? { ...state, distance: d, date: null, time: null }
      : { ...state, distance: d };
    setState(next);
  }

  function onContinue() {
    if (!canAdvance) return;
    // "No specific race" branches into Step 1b for goal + history detail.
    // Every other distance jumps straight to signals (Step 2).
    const nextStep = state.distance === 'none' ? 'goal-details' : 'signals';
    router.push(buildOnboardingHref(state, { step: nextStep }));
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <h1 style={{
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        lineHeight: 0.86,
        fontSize: 'clamp(48px, 8vw, 84px)',
        margin: 0,
        color: 'var(--ink)',
      }}>
        What are you<br />training for?
      </h1>

      <p style={{
        fontFamily: 'var(--f-body)',
        fontSize: 17,
        lineHeight: 1.55,
        color: 'var(--ink)',
        margin: '24px 0 32px',
        maxWidth: 520,
      }}>
        Pick a race or pick consistency. We'll build the plan around it.
      </p>

      {/* Distance picker */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 10,
        marginBottom: 20,
        maxWidth: 560,
      }}>
        {DISTANCES.map((d) => {
          const active = state.distance === d.value;
          return (
            <button
              key={d.value}
              type="button"
              onClick={() => pick(d.value)}
              style={{
                gridColumn: d.wide ? 'span 2' : undefined,
                background: active ? 'rgba(255,255,255,0.96)' : 'var(--card-2)',
                border: `1px solid ${active ? 'rgba(255,255,255,0.96)' : 'var(--line)'}`,
                borderRadius: 14,
                padding: '16px 14px',
                textAlign: 'center',
                fontFamily: 'var(--f-body)',
                fontWeight: 700,
                fontSize: 15,
                color: active ? '#2a1a5a' : 'var(--ink)',
                letterSpacing: '0.2px',
                cursor: 'pointer',
              }}
            >
              {d.label}
            </button>
          );
        })}
      </div>

      {/* Race date + goal time (only when race distance picked) */}
      {showRaceInputs && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
          marginBottom: 14,
          maxWidth: 560,
        }}>
          <InputBlock label="RACE DATE">
            <input
              type="date"
              value={state.date ?? ''}
              onChange={(e) => setState({ ...state, date: e.target.value || null })}
              style={{
                appearance: 'none',
                background: 'transparent',
                border: 'none',
                color: 'var(--ink)',
                fontFamily: 'var(--f-display)',
                fontWeight: 700,
                letterSpacing: '-0.015em',
                fontSize: 22,
                padding: 0,
                width: '100%',
                // Native date-picker chrome follows the live (paper) skin.
                colorScheme: 'light',
              }}
            />
          </InputBlock>
          <InputBlock label="GOAL TIME · OPTIONAL">
            <input
              type="text"
              inputMode="numeric"
              placeholder="—:—:—"
              value={state.time ?? ''}
              onChange={(e) => setState({ ...state, time: e.target.value || null })}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--ink)',
                fontFamily: 'var(--f-display)',
                fontWeight: 700,
                letterSpacing: '-0.015em',
                fontSize: 22,
                padding: 0,
                width: '100%',
              }}
            />
          </InputBlock>
        </div>
      )}

      {/* "No specific race" alternate copy */}
      {showConsistencyCallout && (
        <div style={{
          background: 'var(--card-2)',
          border: '1px solid var(--line)',
          borderRadius: 14,
          padding: '18px 18px',
          marginBottom: 18,
          maxWidth: 560,
        }}>
          <div style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 700,
            letterSpacing: '-0.015em',
            fontSize: 24,
            color: 'var(--ink)',
            marginBottom: 6,
          }}>
            Just want to run consistently
          </div>
          <div style={{
            fontFamily: 'var(--f-body)',
            fontSize: 13,
            color: 'var(--mute)',
            lineHeight: 1.5,
          }}>
            Faff still builds your week, just without a race anchor. You can pick a race any time and the plan recalibrates.
          </div>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* CTAs */}
      <button
        type="button"
        onClick={onContinue}
        disabled={!canAdvance}
        style={{
          background: canAdvance ? '#fff' : 'rgba(255,255,255,0.35)',
          color: '#2a1a5a',
          fontFamily: 'var(--f-display)',
          fontWeight: 700,
          letterSpacing: '-0.015em',
          fontSize: 22,
          padding: 18,
          borderRadius: 16,
          textAlign: 'center',
          textTransform: 'uppercase',
          border: 'none',
          cursor: canAdvance ? 'pointer' : 'not-allowed',
          maxWidth: 480,
          opacity: canAdvance ? 1 : 0.6,
          marginTop: 24,
        }}
      >
        Continue
      </button>
    </div>
  );
}

function InputBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{
      display: 'block',
      background: 'var(--card-2)',
      border: '1px solid var(--line)',
      borderRadius: 14,
      padding: '14px 16px',
      cursor: 'text',
    }}>
      <div style={{
        fontFamily: 'var(--f-body)',
        fontWeight: 700,
        fontSize: 9,
        letterSpacing: '1.6px',
        textTransform: 'uppercase',
        color: 'var(--dim)',
        marginBottom: 6,
      }}>
        {label}
      </div>
      {children}
    </label>
  );
}
