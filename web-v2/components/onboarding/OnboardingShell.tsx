/**
 * OnboardingShell — modal-style wrapper for the Lilian flow.
 *
 * Owns:
 *   · Full-viewport gradient face. Goal-dependent · user feedback
 *     2026-05-28 retired the purple (g-new) default. Mapping now:
 *       · landing (no pick yet) → g-race  (orange · default assumption: racing)
 *       · goal=5k/10k/half/marathon → g-race (stays orange)
 *       · goal=none (just run consistently) → g-long (blue · aerobic identity)
 *       · goal=tt (time-trial under N) → g-quality (amber/orange · interval identity)
 *       · completion → matches whatever they picked (carries momentum)
 *   · Brand wordmark + back link in a thin top strip (no TopNav — the
 *     flow is intentionally a modal experience).
 *   · Step indicator (progress dots · 3 segments · highlights current).
 *   · "X of 3 steps" label.
 *
 * Does NOT own:
 *   · The hero verb (each step picks its own copy).
 *   · The CTAs (each step renders its own primary + secondary).
 *   · Page padding (each step controls its own inner padding).
 */

import Link from 'next/link';
import type { OnboardingState } from '@/lib/onboarding/state';

/** Goal-intent · drives the face gradient. */
export type OnboardingIntent =
  | 'landing'      // no pick yet · default = race-orange
  | 'race'         // picked 5k/10k/half/marathon
  | 'consistency'  // picked "no specific race · just run"
  | 'tt-goal';     // picked a time-trial goal (1mi / 5k / 10k under X)

export interface OnboardingShellProps {
  state: OnboardingState;
  /** Variant decides which face gradient renders. */
  variant: 'new' | 'done';
  /** Goal-intent picked so far · drives the gradient color. */
  intent?: OnboardingIntent;
  /** Where the small "← Back" link in the top strip should go. */
  backHref?: string;
  /** Step number for the indicator (1, 2, 3, null on landing/done). */
  stepNumber: 1 | 2 | 3 | null;
  children: React.ReactNode;
}

/** Resolve gradient token per (variant, intent). Completion mirrors the
 *  intent the runner picked so the momentum carries through. */
function gradientFor(variant: 'new' | 'done', intent: OnboardingIntent): string {
  // Completion carries the intent's color forward — the runner finishes on
  // the same vibe they picked. Falls back to g-done (green→teal) when
  // intent is still landing (shouldn't normally happen).
  if (variant === 'done') {
    switch (intent) {
      case 'race':         return 'var(--g-race)';
      case 'consistency':  return 'var(--g-long)';
      case 'tt-goal':      return 'var(--g-quality)';
      case 'landing':
      default:             return 'var(--g-done)';
    }
  }
  // All other steps · the in-flow gradient follows the intent.
  switch (intent) {
    case 'race':         return 'var(--g-race)';
    case 'consistency':  return 'var(--g-long)';
    case 'tt-goal':      return 'var(--g-quality)';
    case 'landing':
    default:             return 'var(--g-race)'; // default = race-orange (the assumption)
  }
}

export function OnboardingShell({
  state: _state, variant, intent = 'landing', backHref, stepNumber, children,
}: OnboardingShellProps) {
  const faceBg = gradientFor(variant, intent);

  return (
    <main className="ob-shell" style={{
      minHeight: '100vh',
      background: faceBg,
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* 2026-06-10 · web framing (David: "looks like the iphone option
          but on the web") · the deck was a phone flow stretched across
          the desktop viewport — hero mid-left, CTA flexed to the bottom
          of a 1300px window. On ≥900px the column now centers both ways
          and caps its height so each step reads as one composed unit.
          Below 900px nothing changes — the phone flow IS the design. */}
      <style>{`
        @media (min-width: 900px) {
          .ob-shell .ob-col {
            flex: initial;
            margin: auto;
            width: 640px;
            min-height: 620px;
            max-height: 800px;
            padding: 48px 40px;
          }
        }
      `}</style>
      {/* Top strip · brand left, back right */}
      <header style={{
        padding: '24px 28px 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontFamily: 'var(--f-body)',
        fontSize: 11,
        letterSpacing: '2.2px',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: 'rgba(255,255,255,0.85)',
      }}>
        <span>faff</span>
        {backHref && (
          <Link href={backHref} style={{
            color: 'rgba(255,255,255,0.7)',
            textDecoration: 'none',
            letterSpacing: '1.4px',
          }}>← BACK</Link>
        )}
      </header>

      {/* Content column · centered card on desktop, full-bleed on phone */}
      <div className="ob-col" style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        maxWidth: 760,
        width: '100%',
        margin: '0 auto',
        padding: '40px 28px 36px',
      }}>
        {/* Step indicator · only on goal/signals/confirm */}
        {stepNumber && (
          <div style={{ marginBottom: 22 }}>
            <div style={{
              fontFamily: 'var(--f-body)',
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: '2.2px',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.85)',
              marginBottom: 14,
            }}>
              STEP {stepNumber} OF 3
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[1, 2, 3].map((n) => (
                <div key={n} style={{
                  width: 22,
                  height: 3,
                  borderRadius: 2,
                  background: n <= stepNumber
                    ? 'rgba(255,255,255,0.95)'
                    : 'rgba(255,255,255,0.22)',
                }} />
              ))}
            </div>
          </div>
        )}

        {children}
      </div>
    </main>
  );
}
