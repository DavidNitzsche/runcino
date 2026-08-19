/**
 * Completion screen · Lilian onboarding.
 *
 * Deck source: docs/2026-05-28-onboarding-lilian.html § COMPLETION.
 *
 * 2026-08-18 (onboarding QA audit): this used to show a HARDCODED mini-poster
 * ("EASY 4.0 · 8:45/mi · ~35m") on every completion regardless of what the
 * backend actually generated — including coached mode (Faff authors NOTHING)
 * and the plan-less "just run" path (no race, no TT goal → NEW FLOW authors
 * nothing at onboarding, see /api/onboarding/complete). That's exactly the
 * "phantom / fabricated number" failure mode the CLAUDE.md race-data-SoT
 * doctrine forbids, just for plans instead of race results. We don't reach
 * into the real plan engine here (the actual first-day workout lifts from
 * the resolver once /today is opened) — so instead of guessing, this screen
 * now states plainly what state the runner is actually in, per mode:
 *   - coached: no plan is authored, ever · Faff tracks the work
 *   - no race + no TT goal (web "just running" / native "just run"): no
 *     plan authored at onboarding · add a race or goal from Today
 *   - everything else (race path, or no-race + TT goal): a plan WAS
 *     seeded server-side · point at Today rather than invent its shape
 */

import Link from 'next/link';
import type { OnboardingState } from '@/lib/onboarding/state';
import { distanceLabel } from '@/lib/onboarding/state';

export function CompletionScreen({ state }: { state: OnboardingState }) {
  const isCoached = state.distance === 'coached';
  // Mirrors /api/onboarding/complete's own branch: isRace() || ttDistance is
  // the only case that seeds a plan; 'none' with no TT goal authors nothing.
  const isRace = state.distance != null && state.distance !== 'none' && state.distance !== 'coached';
  const planSeeded = isRace || Boolean(state.ttDistance);

  const heading = isCoached ? 'YOU’RE SET.' : planSeeded ? 'DAY ONE.' : 'YOU’RE IN.';

  const sub = isCoached
    ? 'Your coach owns the plan. Faff tracks the work — runs, readiness, health — and stays out of the prescriptions.'
    : !planSeeded
      ? 'No plan yet, and that’s fine. Log runs your way, or add a race or goal from Today whenever you want one built.'
      : state.distance === 'none' || !state.date
        ? 'Your plan is building. Head to Today for day one.'
        : `${distanceLabel(state.distance)} plan around ${formatRaceDate(state.date)}. Head to Today for day one.`;

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
        {isCoached ? 'FAFF IS TRACKING' : planSeeded ? 'YOUR PLAN IS BUILT' : 'YOU’RE ALL SET'}
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
        {heading}
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

      {/* 2026-08-18: the mini-poster preview ("EASY 4.0 · 8:45/mi · ~35m")
       *  was removed here — it was a hardcoded placeholder shown on EVERY
       *  completion (including coached + no-plan paths where no workout
       *  exists at all). Real day-one detail lives on /today once the
       *  resolver has actually run; inventing it here was exactly the
       *  fabricated-number failure mode this audit was checking for. */}

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

function formatRaceDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
