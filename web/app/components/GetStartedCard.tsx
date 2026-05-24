'use client';

/**
 * GetStartedCard — onboarding surface for cold-start / data-no-goal /
 * data-with-goal-no-plan modes. Per coach-layer spec §7.1.
 *
 * When the runner is in onboarding mode, the coach speaks in
 * invitations rather than reads. This card surfaces those invitations
 * + a CTA to take the next step. Renders null when out of onboarding.
 *
 * Reads /api/coach/mode (same source as ActiveModeBanner +
 * ModePrescriptionCard for cross-surface consistency).
 */

import { useEffect, useState } from 'react';

interface ModeResponse {
  ok: boolean;
  mode: string;
  onboardingStage: 'cold_start' | 'connected_no_data' | 'data_no_goal' | 'data_with_goal_no_plan' | null;
  modeVoice: string | null;
}

const STAGE_CTA: Record<string, { label: string; href: string } | null> = {
  cold_start:              { label: 'Connect Strava',  href: '/profile' },
  connected_no_data:       null, // wait for data, no CTA
  data_no_goal:            { label: 'Add an A-race',   href: '/races' },
  data_with_goal_no_plan:  { label: 'Generate a plan', href: '/training' },
};

export function GetStartedCard() {
  const [data, setData] = useState<ModeResponse | null>(null);

  useEffect(() => {
    fetch('/api/coach/mode').then((r) => r.json()).then((j: ModeResponse) => {
      if (j.ok) setData(j);
    }).catch(() => {});
  }, []);

  if (!data || data.mode !== 'onboarding' || !data.modeVoice || !data.onboardingStage) return null;
  const cta = STAGE_CTA[data.onboardingStage];

  return (
    <div style={{
      background: '#fff',
      borderRadius: 14,
      padding: '22px 24px',
      marginBottom: 16,
      boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.05)',
      borderLeft: '4px solid #1F3B82',
    }}>
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1.3,
        textTransform: 'uppercase',
        color: '#1F3B82',
        marginBottom: 10,
      }}>
        Welcome · let&apos;s wake the coach up
      </div>
      <div style={{
        fontFamily: 'Jost, sans-serif',
        fontSize: 15,
        lineHeight: 1.55,
        color: '#080808',
        marginBottom: cta ? 14 : 0,
      }}>
        {data.modeVoice}
      </div>
      {cta && (
        <a
          href={cta.href}
          style={{
            display: 'inline-block',
            background: '#E85D26',
            color: '#fff',
            padding: '10px 18px',
            borderRadius: 999,
            fontFamily: 'Oswald, sans-serif',
            fontSize: 12,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          {cta.label}
        </a>
      )}
    </div>
  );
}
