'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { type OnboardingState } from '@/lib/onboarding/state';
import { redesignOnboardingHref } from '@/components/redesign/onboarding/href';
import { Tile } from '@/components/redesign/core/Tile';
import { Badge } from '@/components/redesign/core/Badge';
import { Button } from '@/components/redesign/core/Button';
import { CoachSay } from '@/components/redesign/coach/CoachSay';
import { OnboardingSidebar } from '@/components/redesign/onboarding/OnboardingSidebar';

/**
 * components/redesign/onboarding/Step2SignalsRedesign.tsx
 *
 * Reskin of the live components/onboarding/Step2Signals.tsx. Three
 * connection tiles — Strava (real OAuth), Apple Health, Apple Watch
 * (both iPhone-only per CLAUDE.md "iPhone stays fully native — no
 * web-views", same explicit deferral the live step already makes).
 *
 * Strava connect reuses the EXACT same fetch → navigate pattern the live
 * step and components/redesign/settings/SettingsClient.tsx's own
 * startStravaConnect() both already use: GET /api/auth/strava?action=
 * connect → {url} → window.location.href = url. Not a new integration —
 * the third real call site of an already-proven pattern this session.
 *
 * SAFETY: connectStrava() is read here for correctness against the real
 * endpoint but NOT clicked during verification — David's account is
 * already Strava-connected; firing this would re-run OAuth against his
 * live connection for no reason. The "Continue"/"Skip for now" buttons
 * (pure URL-state advances, no network) are safe and were exercised.
 */
export function Step2SignalsRedesign({ initial }: { initial: OnboardingState }) {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);

  async function connectStrava() {
    setConnecting(true);
    try {
      const r = await fetch('/api/auth/strava?action=connect');
      const j = await r.json().catch(() => ({}));
      if (j?.url) {
        window.location.href = j.url;
      } else {
        setConnecting(false);
      }
    } catch {
      setConnecting(false);
    }
  }

  function onContinue(skipped: boolean) {
    router.push(redesignOnboardingHref(initial, {
      step: 'confirm',
      connectionsSkipped: skipped || initial.connectionsSkipped,
    }));
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 'var(--sp-6)', alignItems: 'start' }}>
      <Tile pad="lg" radius="2xl">
        <div className="faff-display" style={{ fontSize: 'var(--type-display-3)', lineHeight: 'var(--lh-display-3)' }}>
          Let Faff see your runs and body.
        </div>
        <CoachSay size="sm" attribution={null} style={{ padding: 'var(--sp-6) 0 var(--sp-8)' }}>
          Connect any combination. I need at least one source to build the plan around real data.
        </CoachSay>

        <div style={{ display: 'grid', gap: 'var(--sp-6)' }}>
          <SignalTile
            name="Strava" meta="Run history, pace, routes" connected={initial.stravaConnected}
            cta={initial.stravaConnected ? 'Strava connected — runs sync now' : (connecting ? 'Opening…' : 'Connect Strava')}
            onClick={initial.stravaConnected ? undefined : connectStrava}
            disabled={connecting}
          />
          <SignalTile name="Apple Health" meta="RHR, sleep, HRV, VO2max" connected={false}
            cta="Open on iPhone" help="HealthKit lives on your iPhone. Open Faff there to grant access." />
          <SignalTile name="Apple Watch" meta="Live heart rate, on-wrist coach" connected={false}
            cta="Open on iPhone" help="Pair from the iPhone app — the watch app installs automatically." />
        </div>

        <div style={{ display: 'flex', gap: 'var(--sp-5)', marginTop: 'var(--sp-10)' }}>
          <Button onClick={() => onContinue(false)}>Continue</Button>
          <Button variant="ghost" onClick={() => onContinue(true)}>Skip for now</Button>
        </div>
      </Tile>

      <OnboardingSidebar whatYouGet="At least one source lets Faff build the week around what actually happened, not a guess." />
    </div>
  );
}

function SignalTile({ name, meta, connected, cta, help, onClick, disabled }: {
  name: string; meta: string; connected: boolean; cta: string; help?: string;
  onClick?: () => void; disabled?: boolean;
}) {
  return (
    <Tile tone="raised" pad="sm" flat onClick={onClick} style={onClick && !disabled ? { cursor: 'pointer' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-6)' }}>
        <div>
          <div style={{ fontSize: 'var(--type-body-s)', fontWeight: 'var(--weight-semibold)' }}>{name}</div>
          <div style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', marginTop: 2 }}>{meta}</div>
        </div>
        <Badge tone={connected ? 'easy' : 'quiet'}>{connected ? 'Connected' : 'Not connected'}</Badge>
      </div>
      {help && <div style={{ marginTop: 'var(--sp-5)', fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)' }}>{help}</div>}
      <div style={{ marginTop: 'var(--sp-5)', fontSize: 'var(--type-label-s)', fontWeight: 'var(--weight-semibold)', color: connected ? 'var(--text-secondary)' : 'var(--signal)', opacity: disabled ? 0.6 : 1 }}>
        {cta}
      </div>
    </Tile>
  );
}
