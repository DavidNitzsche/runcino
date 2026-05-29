/**
 * Step 3 · Confirm + Name · Lilian onboarding.
 *
 * Deck source: docs/2026-05-28-onboarding-lilian.html § STEP 3 · CONFIRM.
 *
 * Auto-fills first name from Strava (best-effort — falls back to empty
 * if no token). Time zone auto-detects via Intl. Goal summary card
 * reflects what was picked in step 1. Submitting POSTs to
 * /api/onboarding/complete which writes profile.* (migration 115).
 */

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  buildOnboardingHref,
  canSubmit,
  distanceLabel,
  timezoneShortLabel,
  type OnboardingState,
} from '@/lib/onboarding/state';

export interface Step3ConfirmProps {
  initial: OnboardingState;
  /** Server-resolved first name guess (from Strava token / profile). */
  initialName: string | null;
}

export function Step3Confirm({ initial, initialName }: Step3ConfirmProps) {
  const router = useRouter();
  // The URL's `name` param wins if present (back-button workflow);
  // otherwise the server-resolved guess seeds the input.
  const [name, setName] = useState(initial.name ?? initialName ?? '');
  const [timezone, setTimezone] = useState<string | null>(initial.timezone);
  const [editingTz, setEditingTz] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect timezone on mount if not already set in the URL.
  useEffect(() => {
    if (timezone) return;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) setTimezone(tz);
    } catch {
      // Some old browsers will throw — fall back to UTC.
      setTimezone('UTC');
    }
  }, [timezone]);

  const finalState: OnboardingState = {
    ...initial,
    name: name.trim() || null,
    timezone,
  };
  const ready = canSubmit(finalState) && !submitting;

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distance: initial.distance,
          date: initial.date,
          time: initial.time,
          name: name.trim(),
          timezone,
          connectionsSkipped: initial.connectionsSkipped,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) {
        throw new Error(j?.error ?? 'Could not save your answers');
      }
      router.push(j.redirect ?? '/onboarding?step=done');
    } catch (e: any) {
      setSubmitting(false);
      setError(e.message ?? 'Something went wrong');
    }
  }

  // Build the goal-summary string from step 1 answers.
  const goalSummary = (() => {
    if (!initial.distance) return '—';
    if (initial.distance === 'none') return 'Just running consistently';
    const parts: string[] = [distanceLabel(initial.distance)];
    if (initial.date) {
      const d = new Date(initial.date + 'T00:00:00');
      parts.push(d.toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric',
      }));
    }
    if (initial.time) parts.push(initial.time);
    return parts.join(' · ');
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <h1 style={{
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        letterSpacing: '-0.015em',
        lineHeight: 0.86,
        fontSize: 'clamp(48px, 8vw, 84px)',
        margin: 0,
        color: '#fff',
      }}>
        Last thing.<br />Who are you?
      </h1>

      <p style={{
        fontFamily: 'var(--f-body)',
        fontSize: 17,
        lineHeight: 1.55,
        color: 'rgba(255,255,255,0.86)',
        margin: '24px 0 32px',
        maxWidth: 520,
      }}>
        A name to call you and we'll start building.
      </p>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        marginBottom: 22,
        maxWidth: 480,
      }}>
        {/* Name input */}
        <FormRow label="NAME" hint={initialName ? 'FROM STRAVA' : null}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fff',
              fontFamily: 'var(--f-body)',
              fontWeight: 600,
              fontSize: 17,
              padding: 0,
              width: '100%',
              outline: 'none',
            }}
          />
        </FormRow>

        {/* Time zone · auto with inline change */}
        <FormRow
          label="TIME ZONE"
          hint={editingTz ? null : 'DETECTED'}
          right={editingTz ? null : (
            <button
              type="button"
              onClick={() => setEditingTz(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.7)',
                fontFamily: 'var(--f-body)',
                fontSize: 11,
                letterSpacing: '0.2px',
                cursor: 'pointer',
                textDecoration: 'underline',
                padding: 0,
              }}
            >
              change
            </button>
          )}
        >
          {editingTz ? (
            <input
              type="text"
              value={timezone ?? ''}
              onChange={(e) => setTimezone(e.target.value || null)}
              onBlur={() => setEditingTz(false)}
              autoFocus
              placeholder="e.g. America/Los_Angeles"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fff',
                fontFamily: 'var(--f-body)',
                fontWeight: 600,
                fontSize: 17,
                padding: 0,
                width: '100%',
                outline: 'none',
              }}
            />
          ) : (
            <div style={{
              fontFamily: 'var(--f-body)',
              fontWeight: 600,
              fontSize: 17,
              color: '#fff',
            }}>
              {timezoneShortLabel(timezone)}
            </div>
          )}
        </FormRow>

        {/* Goal confirmation */}
        <FormRow label="GOAL" hint="FROM STEP 1">
          <div style={{
            fontFamily: 'var(--f-body)',
            fontWeight: 600,
            fontSize: 17,
            color: '#fff',
          }}>
            {goalSummary}
          </div>
        </FormRow>
      </div>

      {error && (
        <div style={{
          color: '#FFD1D1',
          background: 'rgba(252,77,100,0.18)',
          border: '1px solid rgba(252,77,100,0.4)',
          borderRadius: 12,
          padding: '12px 14px',
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          marginBottom: 14,
          maxWidth: 480,
        }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1 }} />

      <button
        type="button"
        onClick={submit}
        disabled={!ready}
        style={{
          background: ready ? '#fff' : 'rgba(255,255,255,0.35)',
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
          cursor: ready ? 'pointer' : 'not-allowed',
          maxWidth: 480,
          opacity: ready ? 1 : 0.6,
          marginTop: 24,
        }}
      >
        {submitting ? 'Building…' : 'Start training'}
      </button>
      <a
        href={buildOnboardingHref(initial, { step: 'signals' })}
        style={{
          marginTop: 14,
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          color: 'rgba(255,255,255,0.7)',
          textAlign: 'left',
          textDecoration: 'underline',
          maxWidth: 480,
        }}
      >
        ← Back
      </a>
    </div>
  );
}

function FormRow({
  label, hint, right, children,
}: {
  label: string;
  hint?: string | null;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: 14,
      padding: '14px 18px',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 6,
        fontFamily: 'var(--f-body)',
        fontWeight: 700,
        fontSize: 9,
        letterSpacing: '1.6px',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.6)',
      }}>
        <div>
          {label}
          {hint && (
            <span style={{
              marginLeft: 10,
              color: 'rgba(255,255,255,0.5)',
              letterSpacing: '1.2px',
            }}>{hint}</span>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}
