'use client';

/**
 * Max HR validation banner — the first surface of the ADAPTIVE
 * RECOMMENDATION pattern.
 *
 * Renders inside the Coach Reads card when the validator detects
 * that stored max HR doesn't match the runner's actual data. Two
 * actions:
 *
 *   - Apply  → POST to /api/profile/max-hr with the suggested value.
 *              Server clears any prior dismissal so future drift
 *              can re-prompt.
 *   - Keep current → POST to /api/profile/max-hr/validate/dismiss.
 *              Banner suppresses for 30 days; re-fires if a
 *              validated peak ≥ stored+3 bpm appears.
 *
 * Falsifier copy ("what would change our mind") shows under the
 * action row so the recommendation is auditable.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MaxHrValidationVerdict } from '@/lib/validate-max-hr';

interface Props {
  verdict: MaxHrValidationVerdict;
}

export function MaxHrValidationBanner({ verdict }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'apply' | 'dismiss' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (!verdict.hasFinding || verdict.dismissed || dismissed) return null;

  const rec = verdict.recommendation;
  if (rec.kind === 'looks-correct' || rec.kind === 'insufficient-data') return null;

  // Pick the value the Apply button writes.
  const applyValue = rec.kind === 'peak-exceeds-current'
    ? rec.peakHr
    : rec.kind === 'race-suggests-higher'
      ? rec.suggested
      : rec.kind === 'suspect-ceiling'
        ? rec.suggested
        : null;

  async function onApply() {
    if (applyValue == null) return;
    setBusy('apply'); setErr(null);
    try {
      const res = await fetch('/api/profile/max-hr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxHr: applyValue }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j?.error || 'Save failed');
      } else {
        // Hard reload so the client-side MaxHrIsland re-mounts and
        // re-fetches. router.refresh() only re-renders server
        // components; client islands keep their useState from before
        // and would show stale values. (David caught this 2026-05-19
        // round 3 — top max HR card showed 175 while Coach Reads
        // showed 181 after Apply.)
        window.location.reload();
      }
    } catch { setErr('Network error'); }
    finally { setBusy(null); }
  }

  async function onDismiss() {
    setBusy('dismiss'); setErr(null);
    try {
      const res = await fetch('/api/profile/max-hr/validate/dismiss', { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j?.error || 'Dismiss failed');
      } else {
        setDismissed(true);
      }
    } catch { setErr('Network error'); }
    finally { setBusy(null); }
  }

  return (
    <div className="mhr-banner">
      <div className="mhr-banner-icon">⚠</div>
      <div className="mhr-banner-body">
        <div className="mhr-banner-title">Stored max HR may be off</div>
        <div className="mhr-banner-reason">{rec.reason}</div>
        <div className="mhr-banner-actions">
          {applyValue != null && (
            <button
              type="button"
              className="mhr-apply"
              onClick={onApply}
              disabled={busy !== null}
            >
              {busy === 'apply' ? 'Applying…' : `Apply · ${applyValue} bpm`}
            </button>
          )}
          <button
            type="button"
            className="mhr-keep"
            onClick={onDismiss}
            disabled={busy !== null}
          >
            {busy === 'dismiss' ? 'Dismissing…' : 'Keep current (suppress 30d)'}
          </button>
          {err && <span className="mhr-err">{err}</span>}
        </div>
        <div className="mhr-banner-falsifier">
          <strong>What would change our mind: </strong>
          {rec.falsifier}
        </div>
      </div>
      <style jsx>{`
        .mhr-banner {
          display: flex; gap: 12px;
          padding: 14px 16px;
          margin: 12px 40px 0;
          background: rgba(212,144,10,.08);
          border: 1px solid rgba(212,144,10,.32);
          border-radius: 10px;
        }
        .mhr-banner-icon {
          font-size: 18px; line-height: 1.2;
          color: #D4900A; flex-shrink: 0;
        }
        .mhr-banner-body { flex: 1; min-width: 0; }
        .mhr-banner-title {
          font-family: 'Inter', sans-serif; font-weight: 700;
          font-size: 13px; color: #0D0F12;
          margin-bottom: 4px;
        }
        .mhr-banner-reason {
          font-family: 'Inter', sans-serif; font-size: 13px;
          line-height: 1.5; color: rgba(13,15,18,.75);
        }
        .mhr-banner-actions {
          display: flex; flex-wrap: wrap; gap: 8px;
          margin-top: 10px; align-items: center;
        }
        .mhr-apply, .mhr-keep {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
          padding: 7px 12px; border-radius: 6px; cursor: pointer;
          border: 1px solid;
        }
        .mhr-apply { background: #0D0F12; color: #fff; border-color: #0D0F12; }
        .mhr-apply:disabled { opacity: 0.5; cursor: not-allowed; }
        .mhr-keep {
          background: transparent; color: rgba(13,15,18,.55);
          border-color: rgba(13,15,18,.18);
        }
        .mhr-keep:disabled { opacity: 0.5; cursor: not-allowed; }
        .mhr-err {
          font-family: 'Inter', sans-serif; font-size: 11px; color: #B00020;
        }
        .mhr-banner-falsifier {
          font-family: 'Inter', sans-serif; font-size: 11px;
          line-height: 1.5; color: rgba(13,15,18,.55);
          margin-top: 8px; padding-top: 8px;
          border-top: 1px solid rgba(13,15,18,.06);
          font-style: italic;
        }
        .mhr-banner-falsifier strong {
          color: rgba(13,15,18,.75);
          font-style: normal;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
