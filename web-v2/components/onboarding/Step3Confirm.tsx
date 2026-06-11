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
  ttDistanceLabel,
  type OnboardingState,
} from '@/lib/onboarding/state';

export interface Step3ConfirmProps {
  initial: OnboardingState;
  /** Server-resolved first name guess (from Strava token / profile). */
  initialName: string | null;
}

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function Step3Confirm({ initial, initialName }: Step3ConfirmProps) {
  const router = useRouter();
  // The URL's `name` param wins if present (back-button workflow);
  // otherwise the server-resolved guess seeds the input.
  const [name, setName] = useState(initial.name ?? initialName ?? '');
  const [timezone, setTimezone] = useState<string | null>(initial.timezone);
  const [editingTz, setEditingTz] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Body fields (T2 physiology · pass-5 onboarding A+ work).
  // Optional but strongly encouraged — without these the coach hedges
  // every HR-derived prescription. UI keeps them light: birthday is a
  // YYYY-MM-DD date input; sex is M/F (medical/research split, not
  // identity); height captured as ft + in, converted to cm on submit.
  const [birthday, setBirthday] = useState<string>('');
  const [sex, setSex] = useState<'M' | 'F' | ''>('');
  const [heightFt, setHeightFt] = useState<string>('');
  const [heightIn, setHeightIn] = useState<string>('');

  // 2026-06-10 · scheduling (David: "ask them when they want to start ·
  // what day the long runs should be on · people sign up in the evening
  // and want to start tomorrow"). Local component state · POSTed on
  // submit · drives the plan's start day + long-run day. Defaults: start
  // today, long run Sunday. Plan-authoring paths only (coached skips —
  // Faff authors no plan for them).
  const localISO = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const todayLocal = localISO(0);
  const tomorrowLocal = localISO(1);
  const maxStartLocal = localISO(21);
  const [startDate, setStartDate] = useState<string>(todayLocal);
  const [longRunDay, setLongRunDay] = useState<DayKey>('sun');
  const authorsPlan = initial.distance !== 'coached';

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
          // Step 1b · no-race goal-details (silently null on race paths).
          ttDistance: initial.ttDistance,
          ttTime: initial.ttTime,
          weeklyMi: initial.weeklyMi,
          weeklyFreq: initial.weeklyFreq,
          histAvg: initial.histAvg,
          histLong: initial.histLong,
          histYears: initial.histYears,
          // 2026-06-03 · race history (TASK B4) · captured on Step 1b
          // for the no-race path, but could be added on race path too
          // once UI ships it there. Empty array = "first race ever".
          raceHistory: initial.raceHistory,
          name: name.trim(),
          timezone,
          // 2026-06-10 · scheduling · plan start day + long-run day.
          // Null on coached (no plan); server clamps/validates.
          startDate: authorsPlan ? startDate : undefined,
          longRunDay: authorsPlan ? longRunDay : undefined,
          connectionsSkipped: initial.connectionsSkipped,
          // T2 physiology — optional, COALESCE'd server-side so empty
          // fields don't clobber existing values.
          birthday: birthday || undefined,
          sex: sex || undefined,
          height_cm: (heightFt || heightIn)
            ? Math.round((Number(heightFt || 0) * 12 + Number(heightIn || 0)) * 2.54)
            : undefined,
        }),
      });
      if (r.status === 401) {
        // Anonymous runner finished the deck — send them to sign in
        // (invite-only since 2026-06-10: existing accounts only; the
        // login page carries the REQUEST ACCESS door). They return HERE
        // with every answer intact — deck state lives in the URL.
        const here = window.location.pathname + window.location.search;
        window.location.href = `/login?next=${encodeURIComponent(here)}`;
        return;
      }
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

  // Build the goal-summary string from step 1 (and 1b on no-race path).
  const goalSummary = (() => {
    if (!initial.distance) return '—';
    if (initial.distance === 'coached') {
      return "My coach's plan · Faff tracks the work";
    }
    if (initial.distance === 'none') {
      const parts: string[] = [];
      if (initial.ttDistance && initial.ttTime) {
        parts.push(`${ttDistanceLabel(initial.ttDistance)} ${initial.ttTime.toLowerCase()}`);
      }
      if (initial.weeklyMi != null && initial.weeklyFreq != null) {
        parts.push(`${initial.weeklyMi} mi/wk over ${initial.weeklyFreq} days`);
      }
      return parts.length > 0 ? parts.join(' · ') : 'Just running consistently';
    }
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

  // History summary — only rendered on the no-race path. When Strava is
  // connected we just note the source; otherwise echo the chip picks.
  const showHistorySummary = initial.distance === 'none';
  const historySummary = (() => {
    if (initial.stravaConnected) return 'Live · pulled from Strava';
    const parts: string[] = [];
    if (initial.histAvg) parts.push(`${initial.histAvg} mi/wk avg`);
    if (initial.histLong) parts.push(`longest recent ${initial.histLong}mi`);
    if (initial.histYears) parts.push(`${initial.histYears} years`);
    return parts.length > 0 ? parts.join(' · ') : '—';
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
        color: 'var(--ink)',
      }}>
        Last thing.<br />Who are you?
      </h1>

      <p style={{
        fontFamily: 'var(--f-body)',
        fontSize: 17,
        lineHeight: 1.55,
        color: 'var(--ink)',
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
              color: 'var(--ink)',
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
                color: 'var(--mute)',
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
                color: 'var(--ink)',
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
              color: 'var(--ink)',
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
            color: 'var(--ink)',
          }}>
            {goalSummary}
          </div>
        </FormRow>

        {/* Running history (no-race path only) */}
        {showHistorySummary && (
          <FormRow label="RUNNING HISTORY" hint="FROM STEP 1B">
            <div style={{
              fontFamily: 'var(--f-body)',
              fontWeight: 600,
              fontSize: 17,
              color: 'var(--ink)',
            }}>
              {historySummary}
            </div>
          </FormRow>
        )}

        {/* Scheduling · start day + long-run day. Plan-authoring paths
            only (coached has no Faff plan to schedule). */}
        {authorsPlan && (
          <>
            <FormRow label="WHEN DO YOU WANT TO START?" hint="YOUR FIRST RUN LANDS THIS DAY">
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {([['Today', todayLocal], ['Tomorrow', tomorrowLocal]] as const).map(([lab, val]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setStartDate(val)}
                    style={{
                      background: startDate === val ? 'rgba(255,255,255,0.18)' : 'transparent',
                      border: `1px solid ${startDate === val ? 'var(--ink)' : 'rgba(255,255,255,0.20)'}`,
                      color: startDate === val ? 'var(--ink)' : 'var(--mute)',
                      fontFamily: 'var(--f-body)', fontWeight: 700, fontSize: 14,
                      letterSpacing: '0.6px', padding: '6px 18px', borderRadius: 10, cursor: 'pointer',
                      textTransform: 'uppercase',
                    }}
                  >
                    {lab}
                  </button>
                ))}
                <input
                  type="date"
                  min={todayLocal}
                  max={maxStartLocal}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={{
                    background: (startDate !== todayLocal && startDate !== tomorrowLocal) ? 'rgba(255,255,255,0.10)' : 'transparent',
                    border: '1px solid rgba(255,255,255,0.20)', borderRadius: 10,
                    color: 'var(--ink)', fontFamily: 'var(--f-body)', fontWeight: 600, fontSize: 14,
                    padding: '6px 10px', outline: 'none', colorScheme: 'dark',
                  }}
                />
              </div>
            </FormRow>

            <FormRow label="LONG RUN DAY" hint="YOUR WEEKLY LONG RUN LANDS HERE">
              <div style={{ display: 'flex', gap: 6 }}>
                {DAY_KEYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setLongRunDay(d)}
                    aria-label={d}
                    style={{
                      background: longRunDay === d ? 'rgba(255,255,255,0.18)' : 'transparent',
                      border: `1px solid ${longRunDay === d ? 'var(--ink)' : 'rgba(255,255,255,0.20)'}`,
                      color: longRunDay === d ? 'var(--ink)' : 'var(--mute)',
                      fontFamily: 'var(--f-body)', fontWeight: 700, fontSize: 14,
                      width: 38, height: 38, borderRadius: 10, cursor: 'pointer',
                    }}
                  >
                    {DAY_LETTERS[i]}
                  </button>
                ))}
              </div>
            </FormRow>
          </>
        )}

        {/* T2 physiology · optional but strongly encouraged.
            Without these the coach hedges every HR-derived prescription.
            Birthday → age (HR zone math, age-graded VDOT).
            Sex → Research/13 personalization, screening.
            Height → cadence-overstriding threshold (Research/16/21). */}
        <FormRow label="BIRTHDAY" hint="OPTIONAL · UNLOCKS AGE-GRADED ZONES">
          <input
            type="date"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
            style={{
              background: 'transparent', border: 'none', color: 'var(--ink)',
              fontFamily: 'var(--f-body)', fontWeight: 600, fontSize: 17,
              padding: 0, width: '100%', outline: 'none',
              colorScheme: 'dark',
            }}
          />
        </FormRow>

        <FormRow label="SEX" hint="OPTIONAL · RESEARCH/13 PERSONALIZATION">
          <div style={{ display: 'flex', gap: 10 }}>
            {(['M', 'F'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setSex(sex === opt ? '' : opt)}
                style={{
                  background: sex === opt ? 'rgba(255,255,255,0.18)' : 'transparent',
                  border: `1px solid ${sex === opt ? 'var(--ink)' : 'rgba(255,255,255,0.20)'}`,
                  color: sex === opt ? 'var(--ink)' : 'var(--mute)',
                  fontFamily: 'var(--f-body)', fontWeight: 700, fontSize: 14,
                  letterSpacing: '0.6px',
                  padding: '6px 18px', borderRadius: 10, cursor: 'pointer',
                  textTransform: 'uppercase',
                }}
              >
                {opt === 'M' ? 'Male' : 'Female'}
              </button>
            ))}
          </div>
        </FormRow>

        <FormRow label="HEIGHT" hint="OPTIONAL · UNLOCKS CADENCE COACHING">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <input
                type="number"
                inputMode="numeric"
                min={3}
                max={8}
                value={heightFt}
                onChange={(e) => setHeightFt(e.target.value)}
                placeholder="5"
                style={{
                  background: 'transparent', border: 'none', color: 'var(--ink)',
                  fontFamily: 'var(--f-body)', fontWeight: 600, fontSize: 17,
                  padding: 0, width: 36, outline: 'none',
                }}
              />
              <span style={{ color: 'var(--ink)', fontFamily: 'var(--f-body)', fontWeight: 600, fontSize: 17 }}>ft</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={11}
                value={heightIn}
                onChange={(e) => setHeightIn(e.target.value)}
                placeholder="10"
                style={{
                  background: 'transparent', border: 'none', color: 'var(--ink)',
                  fontFamily: 'var(--f-body)', fontWeight: 600, fontSize: 17,
                  padding: 0, width: 36, outline: 'none',
                }}
              />
              <span style={{ color: 'var(--ink)', fontFamily: 'var(--f-body)', fontWeight: 600, fontSize: 17 }}>in</span>
            </div>
          </div>
        </FormRow>
      </div>

      {error && (
        <div style={{
          color: 'var(--over)',
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
          color: 'var(--mute)',
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
      background: 'var(--card-2)',
      border: '1px solid var(--line)',
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
        color: 'var(--dim)',
      }}>
        <div>
          {label}
          {hint && (
            <span style={{
              marginLeft: 10,
              color: 'var(--dim)',
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
