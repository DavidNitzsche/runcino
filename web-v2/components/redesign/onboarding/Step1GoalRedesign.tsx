'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  canAdvanceFromGoal,
  type OnboardingState,
  type RaceDistance,
  type TTDistance,
} from '@/lib/onboarding/state';
import { redesignOnboardingHref } from '@/components/redesign/onboarding/href';
import { Tile } from '@/components/redesign/core/Tile';
import { Radio } from '@/components/redesign/core/Radio';
import { Input } from '@/components/redesign/core/Input';
import { Button } from '@/components/redesign/core/Button';
import { CoachSay } from '@/components/redesign/coach/CoachSay';
import { OnboardingSidebar } from '@/components/redesign/onboarding/OnboardingSidebar';

/**
 * components/redesign/onboarding/Step1GoalRedesign.tsx
 *
 * Reskin of the live components/onboarding/Step1Goal.tsx, structurally
 * ported from designs/design-review-0818/ui_kits/web/WebDayOne.jsx (per
 * the task brief: WebDayOne IS step 1's mock, not a separate feature).
 *
 * HONESTY GAP: WebDayOne.jsx's own MODES array invents five conceptual
 * radio choices — race / distance / consistent / coached / beginner.
 * The REAL Step1Goal.tsx (and lib/onboarding/state.ts's RaceDistance
 * type) has six actual chip values: 5k, 10k, half, marathon, none,
 * coached. "distance" (goal a distance, no date) and "beginner"
 * (starting from zero) are NOT first-class picks in the real state model
 * — they're sub-paths reached from `none` (the no-race path routes to
 * Step1bGoalDetailsRedesign, which asks a time-trial goal and, via
 * weeklyMi's 0/5 chip values already in the WeeklyMileage type, supports
 * a true-beginner runner). Inventing two extra radio options that don't
 * write to any real field would violate this session's honesty-gap
 * discipline, so this component renders the REAL six-value picker
 * instead, using Radio (the mock's own choice of primitive for "the five
 * onboarding modes" per Radio.tsx's own doc comment) with sub-copy
 * pulled verbatim from the live Step1Goal.tsx's own callout text — not
 * invented.
 *
 * Field contract identical to the live step: same OnboardingState shape,
 * same canAdvanceFromGoal gate, same date/time clearing on mode switch,
 * same "chase the time instead" escape hatch into goal-details with a
 * derived ttDistance. Only the URL prefix changes (redesignOnboardingHref
 * vs buildOnboardingHref) so the flow stays inside /redesign/onboarding.
 *
 * Read-only until Continue — the underlying state only ever lands in the
 * URL here (no network write). Safe to live-verify every pick + the
 * date/time inputs; the network write happens on step 3's submit only,
 * which is verified structurally per the task's safety constraint.
 */

const DISTANCES: { value: RaceDistance; label: string; sub: string }[] = [
  { value: '5k', label: '5K', sub: 'Race-anchored block · date required.' },
  { value: '10k', label: '10K', sub: 'Race-anchored block · date required.' },
  { value: 'half', label: 'Half marathon', sub: 'Race-anchored block · date required.' },
  { value: 'marathon', label: 'Marathon', sub: 'Race-anchored block · date required.' },
  {
    value: 'none', label: 'No specific race',
    sub: 'Faff still builds your week, just without a race anchor. You can pick a race any time and the plan recalibrates.',
  },
  {
    value: 'coached', label: 'I have a coach',
    sub: 'Faff tracks the work (runs, readiness, health) and stays out of the prescriptions.',
  },
];

export function Step1GoalRedesign({ initial }: { initial: OnboardingState }) {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState>(initial);

  const canAdvance = canAdvanceFromGoal(state);
  const showRaceInputs = state.distance != null && state.distance !== 'none' && state.distance !== 'coached';

  function pick(d: RaceDistance) {
    const next: OnboardingState = d === 'none' || d === 'coached'
      ? { ...state, distance: d, date: null, time: null }
      : { ...state, distance: d };
    setState(next);
  }

  /** Mirrors Step1Goal.tsx's chaseTimeInstead() verbatim: a race-path
   *  runner with no date routes into the time-trial ladder instead of
   *  being forced to invent one. */
  function chaseTimeInstead() {
    const tt: TTDistance | null =
      state.distance === '5k' ? '5k' : state.distance === '10k' ? '10k' : null;
    router.push(redesignOnboardingHref(
      { ...state, distance: 'none', date: null, time: null, ttDistance: tt, ttTime: null },
      { step: 'goal-details' },
    ));
  }

  function onContinue() {
    if (!canAdvance) return;
    // Every running path walks Step 1b (current volume + history seeds
    // the ramp); coached skips it (their coach owns the ramp).
    const nextStep = state.distance === 'coached' ? 'signals' : 'goal-details';
    router.push(redesignOnboardingHref(state, { step: nextStep }));
  }

  const whatYouGet = state.distance === 'coached'
    ? "Recaps and fitness reads only — your coach's calendar link shows up alongside your readiness."
    : state.distance === 'none'
      ? 'Base and quality weeks, no taper until a race date exists.'
      : 'A full periodized block into race day — base, build, peak, and a taper.';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--sp-6)', alignItems: 'start' }}>
      <Tile pad="lg" radius="2xl">
        <div className="faff-display" style={{ fontSize: 'var(--type-display-3)', lineHeight: 'var(--lh-display-3)' }}>
          What are you training for?
        </div>
        <CoachSay size="sm" attribution={null} style={{ padding: 'var(--sp-6) 0 var(--sp-8)' }}>
          Pick a race or pick consistency. Five ways in, and only one of them needs a date.
        </CoachSay>

        <div style={{ display: 'grid', gap: 'var(--sp-7)' }}>
          {DISTANCES.map((d) => (
            <Radio key={d.value} checked={state.distance === d.value} onChange={() => pick(d.value)} label={d.label} sub={d.sub} />
          ))}
        </div>

        {showRaceInputs && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-8)', marginTop: 'var(--sp-8)' }}>
            <Input
              label="Race date" type="date" value={state.date ?? ''}
              onChange={(v) => setState({ ...state, date: v || null })}
              helper="I write the block backwards from race day."
            />
            <Input
              label="Goal time" placeholder="—:—:—" value={state.time ?? ''}
              onChange={(v) => setState({ ...state, time: v || null })}
              helper="A goal, not a promise. I will tell you honestly where it sits."
            />
          </div>
        )}

        {showRaceInputs && (
          <div style={{ marginTop: 'var(--sp-6)' }}>
            <Button variant="ghost" size="sm" onClick={chaseTimeInstead}>No race booked yet? Chase the time instead →</Button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 'var(--sp-5)', marginTop: 'var(--sp-10)' }}>
          <Button onClick={onContinue} disabled={!canAdvance}>Continue</Button>
        </div>
      </Tile>

      <OnboardingSidebar whatYouGet={whatYouGet} />
    </div>
  );
}
