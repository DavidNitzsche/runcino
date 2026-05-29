/**
 * OnboardingShell — modal-style wrapper for the Lilian flow.
 *
 * Owns:
 *   · Full-viewport gradient face (g-new on landing/goal/signals/confirm,
 *     g-done on completion).
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

export interface OnboardingShellProps {
  state: OnboardingState;
  /** Variant decides which face gradient renders. */
  variant: 'new' | 'done';
  /** Where the small "← Back" link in the top strip should go. */
  backHref?: string;
  /** Step number for the indicator (1, 2, 3, null on landing/done). */
  stepNumber: 1 | 2 | 3 | null;
  children: React.ReactNode;
}

export function OnboardingShell({
  state: _state, variant, backHref, stepNumber, children,
}: OnboardingShellProps) {
  const faceBg = variant === 'done' ? 'var(--g-done)' : 'var(--g-new)';

  return (
    <main style={{
      minHeight: '100vh',
      background: faceBg,
      color: '#fff',
      display: 'flex',
      flexDirection: 'column',
    }}>
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

      {/* Content column · constrained to 760 on desktop, full-bleed on phone */}
      <div style={{
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
