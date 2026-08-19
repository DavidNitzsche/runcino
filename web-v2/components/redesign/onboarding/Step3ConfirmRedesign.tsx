'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  canSubmit,
  distanceLabel,
  timezoneShortLabel,
  ttDistanceLabel,
  type OnboardingState,
} from '@/lib/onboarding/state';
import { redesignOnboardingHref } from '@/components/redesign/onboarding/href';
import { Tile } from '@/components/redesign/core/Tile';
import { Input } from '@/components/redesign/core/Input';
import { Button } from '@/components/redesign/core/Button';
import { Alert } from '@/components/redesign/feedback/Alert';
import { CoachSay } from '@/components/redesign/coach/CoachSay';
import { OnboardingSidebar } from '@/components/redesign/onboarding/OnboardingSidebar';

/**
 * components/redesign/onboarding/Step3ConfirmRedesign.tsx
 *
 * Reskin of the live components/onboarding/Step3Confirm.tsx — the
 * highest-stakes step in this port, since its submit() is the ONLY
 * write action in the whole flow (POST /api/onboarding/complete, which
 * persists profile.* AND, for plan-authoring paths, calls
 * generatePlan() — real plan generation).
 *
 * The submit() function below is copied FIELD-FOR-FIELD from the live
 * Step3Confirm.tsx: same endpoint, same JSON body shape (verified
 * against app/api/onboarding/complete/route.ts's own body-parsing code
 * during this port — every field name here has a matching `body.<name>`
 * read there), same 401 → /login?next=... redirect, same success →
 * router.push(j.redirect). Nothing here was invented; it is the same
 * write, re-skinned.
 *
 * PER DAVID'S EXPLICIT INSTRUCTION (see task report / commit message):
 * this submit path was verified STRUCTURALLY ONLY — by reading route.ts
 * and confirming this exact body shape against its validation code — and
 * was NEVER fired against a real account during this port. David is
 * already onboarded; running this for real would create duplicate or
 * corrupted plan/profile data. Zero live end-to-end verification of this
 * screen's write path is expected and correct, not a shortcut.
 */
export interface Step3ConfirmRedesignProps {
  initial: OnboardingState;
  initialName: string | null;
}

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function Step3ConfirmRedesign({ initial, initialName }: Step3ConfirmRedesignProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.name ?? initialName ?? '');
  const [timezone, setTimezone] = useState<string | null>(initial.timezone);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [birthday, setBirthday] = useState('');
  const [sex, setSex] = useState<'M' | 'F' | ''>('');
  const [heightFt, setHeightFt] = useState('');
  const [heightIn, setHeightIn] = useState('');

  const localISO = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const todayLocal = localISO(0);
  const tomorrowLocal = localISO(1);
  const [startDate, setStartDate] = useState(todayLocal);
  const [longRunDay, setLongRunDay] = useState<DayKey>('sun');
  const authorsPlan = initial.distance !== 'coached';

  useEffect(() => {
    if (timezone) return;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) setTimezone(tz);
    } catch {
      setTimezone('UTC');
    }
  }, [timezone]);

  const finalState: OnboardingState = { ...initial, name: name.trim() || null, timezone };
  const ready = canSubmit(finalState) && !submitting;

  /** Identical to the live Step3Confirm.tsx's submit() — see file header.
   *  NOT FIRED during this port's verification (see CLAUDE.md safety
   *  constraint quoted there). */
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
          ttDistance: initial.ttDistance,
          ttTime: initial.ttTime,
          weeklyMi: initial.weeklyMi,
          weeklyFreq: initial.weeklyFreq,
          histAvg: initial.histAvg,
          histLong: initial.histLong,
          histYears: initial.histYears,
          raceHistory: initial.raceHistory,
          name: name.trim(),
          timezone,
          startDate: authorsPlan ? startDate : undefined,
          longRunDay: authorsPlan ? longRunDay : undefined,
          connectionsSkipped: initial.connectionsSkipped,
          birthday: birthday || undefined,
          sex: sex || undefined,
          height_cm: (heightFt || heightIn)
            ? Math.round((Number(heightFt || 0) * 12 + Number(heightIn || 0)) * 2.54)
            : undefined,
        }),
      });
      if (r.status === 401) {
        const here = window.location.pathname + window.location.search;
        window.location.href = `/login?next=${encodeURIComponent(here)}`;
        return;
      }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) {
        throw new Error(j?.error ?? 'Could not save your answers');
      }
      // Live route redirects to /onboarding?step=done — rewrite to stay
      // inside the redesigned flow, same rewrite discipline as href.ts.
      const redirect = typeof j.redirect === 'string' ? j.redirect.replace(/^\/onboarding/, '/redesign/onboarding') : '/redesign/onboarding?step=done';
      router.push(redirect);
    } catch (e: any) {
      setSubmitting(false);
      setError(e.message ?? 'Something went wrong');
    }
  }

  const goalSummary = (() => {
    if (!initial.distance) return '—';
    if (initial.distance === 'coached') return "My coach's plan — Faff tracks the work";
    if (initial.distance === 'none') {
      const parts: string[] = [];
      if (initial.ttDistance && initial.ttTime) parts.push(`${ttDistanceLabel(initial.ttDistance)} ${initial.ttTime.toLowerCase()}`);
      if (initial.weeklyMi != null && initial.weeklyFreq != null) parts.push(`${initial.weeklyMi} mi/wk over ${initial.weeklyFreq} days`);
      return parts.length > 0 ? parts.join(' · ') : 'Just running consistently';
    }
    const parts: string[] = [distanceLabel(initial.distance)];
    if (initial.date) {
      const d = new Date(`${initial.date}T00:00:00`);
      parts.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
    }
    if (initial.time) parts.push(initial.time);
    return parts.join(' · ');
  })();

  const showHistorySummary = initial.distance === 'none';
  const historySummary = (() => {
    if (initial.stravaConnected) return 'Live — pulled from Strava';
    const parts: string[] = [];
    if (initial.histAvg) parts.push(`${initial.histAvg} mi/wk avg`);
    if (initial.histLong) parts.push(`longest recent ${initial.histLong}mi`);
    if (initial.histYears) parts.push(`${initial.histYears} years`);
    return parts.length > 0 ? parts.join(' · ') : '—';
  })();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--sp-6)', alignItems: 'start' }}>
      <Tile pad="lg" radius="2xl">
        <div className="faff-display" style={{ fontSize: 'var(--type-display-3)', lineHeight: 'var(--lh-display-3)' }}>
          Last thing. Who are you?
        </div>
        <CoachSay size="sm" attribution={null} style={{ padding: 'var(--sp-6) 0 var(--sp-8)' }}>
          A name to call you, and we&rsquo;ll start building.
        </CoachSay>

        <div style={{ display: 'grid', gap: 'var(--sp-7)' }}>
          <Input label="Name" value={name} onChange={setName} placeholder="Your name"
            helper={initialName ? 'From Strava' : null} />

          <Input label="Time zone" value={timezone ?? ''} onChange={(v) => setTimezone(v || null)}
            helper={`Detected as ${timezoneShortLabel(timezone)} — edit if it's wrong.`} />

          <SummaryRow label="Goal" value={goalSummary} />
          {showHistorySummary && <SummaryRow label="Running history" value={historySummary} />}

          {authorsPlan && (
            <>
              <div>
                <div style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-5)' }}>
                  When do you want to start?
                </div>
                <div style={{ display: 'flex', gap: 'var(--sp-5)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <Button variant={startDate === todayLocal ? 'secondary' : 'ghost'} size="sm" onClick={() => setStartDate(todayLocal)}>Today</Button>
                  <Button variant={startDate === tomorrowLocal ? 'secondary' : 'ghost'} size="sm" onClick={() => setStartDate(tomorrowLocal)}>Tomorrow</Button>
                  <input type="date" min={todayLocal} value={startDate} onChange={(e) => setStartDate(e.target.value)}
                    style={{ background: 'var(--surface-control)', border: 0, borderRadius: 'var(--radius-m)', color: 'var(--text-primary)', padding: '10px 12px', fontFamily: 'var(--font-core)' }} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-5)' }}>
                  Long run day
                </div>
                <div style={{ display: 'flex', gap: 'var(--sp-4)' }}>
                  {DAY_KEYS.map((d, i) => (
                    <Button key={d} variant={longRunDay === d ? 'secondary' : 'ghost'} size="sm"
                      onClick={() => setLongRunDay(d)} style={{ width: 44, padding: 0 }}>{DAY_LETTERS[i]}</Button>
                  ))}
                </div>
              </div>
            </>
          )}

          <Input label="Birthday" type="date" value={birthday} onChange={setBirthday} helper="Optional — unlocks age-graded zones." />
          <div>
            <div style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)', marginBottom: 'var(--sp-5)' }}>Sex</div>
            <div style={{ display: 'flex', gap: 'var(--sp-5)' }}>
              <Button variant={sex === 'M' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSex(sex === 'M' ? '' : 'M')}>Male</Button>
              <Button variant={sex === 'F' ? 'secondary' : 'ghost'} size="sm" onClick={() => setSex(sex === 'F' ? '' : 'F')}>Female</Button>
            </div>
            <div style={{ marginTop: 'var(--sp-4)', fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>Optional — Research/13 personalization.</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-7)' }}>
            <Input label="Height · ft" type="number" value={heightFt} onChange={setHeightFt} placeholder="5" />
            <Input label="Height · in" type="number" value={heightIn} onChange={setHeightIn} placeholder="10" helper="Optional — unlocks cadence coaching." />
          </div>
        </div>

        {error && <Alert tone="fault" style={{ marginTop: 'var(--sp-7)' }}>{error}</Alert>}

        <div style={{ display: 'flex', gap: 'var(--sp-5)', marginTop: 'var(--sp-10)' }}>
          <Button onClick={submit} disabled={!ready}>{submitting ? 'Building…' : 'Start training'}</Button>
        </div>
      </Tile>

      <OnboardingSidebar whatYouGet="Every answer above is what the first week is built from — nothing arrives generic." />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--type-label)', color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--type-body-s)', marginTop: 2 }}>{value}</div>
    </div>
  );
}
