import type { ReactNode } from 'react';
import Link from 'next/link';
import type { OnboardingState } from '@/lib/onboarding/state';
import { Progress } from '@/components/redesign/core/Progress';

/**
 * components/redesign/onboarding/OnboardingShellRedesign.tsx
 *
 * The redesigned onboarding chrome. Reskin of the live components/
 * onboarding/OnboardingShell.tsx, but structurally ported from the
 * outside-studio handoff's own mocks for this screen (designs/
 * design-review-0818/ui_kits/web/WebOnboarding.jsx + WebDayOne.jsx)
 * rather than from the live component it replaces — the live shell's
 * full-viewport intent-colored gradient background is a v1 (2026-05-28
 * Lilian deck) treatment that the actual redesign mock for this screen
 * does NOT use: both WebOnboarding.jsx and WebDayOne.jsx render onto the
 * app's normal page background using the same Tile-card composition
 * every other redesigned screen uses (a `Tile pad="lg" radius="2xl"`
 * primary card + a stacked-Tile sidebar), not a full-bleed mesh. Per
 * CLAUDE.md's "audit before changing": the mock IS the design source for
 * this port, so its actual layout wins over the superseded gradient
 * treatment. The intent → gradient mapping itself is preserved (see
 * `gradientFor` below) and now drives the PRIMARY CARD's edge accent
 * instead of the whole viewport — same semantic (goal picked so far
 * colors the moment), toned to this app's established Tile-card language.
 *
 * Owns:
 *   · Brand kicker + back link (mirrors the live shell's top strip).
 *   · Step indicator — reuses the shared Progress component (value=
 *     stepNumber, max=3, label="Setting up", tail="Step N of 3") instead
 *     of the live shell's bespoke dot row. Same 3-step semantic
 *     (goal+goal-details count as step 1, matching stepNumberFor in
 *     app/redesign/onboarding/page.tsx, mirrored from the live route).
 *   · Two-column frame (`1.4fr 1fr`, WebOnboarding.jsx's own grid) on
 *     desktop; single column below 900px like every other redesigned
 *     screen's responsive collapse.
 *
 * Does NOT own: the headline, CTAs, or sidebar content — every step
 * component renders its own, same division of responsibility as the
 * live shell.
 */

/** Goal-intent · drives the primary card's edge-accent gradient. Same
 *  three intents the live OnboardingShell resolves, reproduced here
 *  since OnboardingIntent isn't exported from a shared module. */
export type OnboardingIntent =
  | 'landing'      // no pick yet · default = race-orange
  | 'race'         // picked 5k/10k/half/marathon
  | 'consistency'  // picked "no specific race · just run" or coached
  | 'tt-goal';     // picked a time-trial goal (no-race path)

function gradientFor(intent: OnboardingIntent): string {
  switch (intent) {
    case 'race': return 'var(--g-race)';
    case 'consistency': return 'var(--g-long)';
    case 'tt-goal': return 'var(--g-quality)';
    case 'landing':
    default: return 'var(--g-race)'; // default assumption: racing
  }
}

export interface OnboardingShellRedesignProps {
  state: OnboardingState;
  variant: 'new' | 'done';
  intent?: OnboardingIntent;
  backHref?: string;
  stepNumber: 1 | 2 | 3 | null;
  children: ReactNode;
}

export function OnboardingShellRedesign({
  state: _state, variant, intent = 'landing', backHref, stepNumber, children,
}: OnboardingShellRedesignProps) {
  const accent = variant === 'done'
    ? (intent === 'race' ? 'var(--g-race)' : intent === 'tt-goal' ? 'var(--g-quality)' : intent === 'consistency' ? 'var(--g-long)' : 'var(--g-done)')
    : gradientFor(intent);

  return (
    <div style={{ maxWidth: 1360, margin: '0 auto', padding: 'var(--sp-9)', display: 'grid', gap: 'var(--sp-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="faff-kicker">faff</span>
        {backHref && (
          <Link href={backHref} style={{ fontSize: 'var(--type-label-s)', color: 'var(--text-quiet)', textDecoration: 'none' }}>
            ← Back
          </Link>
        )}
      </div>

      {stepNumber && (
        <Progress value={stepNumber} max={3} label="Setting up" tail={`Step ${stepNumber} of 3`} style={{ maxWidth: 320 }} />
      )}

      <div style={{ height: 3, width: 64, borderRadius: 2, backgroundImage: accent }} />

      {children}
    </div>
  );
}
