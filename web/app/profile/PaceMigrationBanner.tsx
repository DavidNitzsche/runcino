'use client';

/**
 * Pace-migration banner — one-time UX for the canonical Daniels
 * pace-band correction.
 *
 * History: the previous pacesFromVdot formula derived training paces
 * from race-time interpolation (E = M + 75s, R = mile race pace).
 * The sim sweep at docs/2026-05-19-sim-sweep.md confirmed this
 * drifted systematically from canonical Daniels Table 2 (25
 * large-shift cells across 15 VDOTs × 5 zones). The new resolver
 * (web/lib/training-paces-resolver.ts) reads from Daniels' canonical
 * source images committed at docs/references/.
 *
 * Banner UX:
 *   - Shown on /profile Coach Reads while users.pace_migration_ack_at
 *     is NULL
 *   - Explains the one-time correction in plain language
 *   - Confirm button POSTs /api/profile/acknowledge-pace-migration
 *   - On success, banner disappears via a reload
 *
 * After acknowledgment, ongoing pace shifts (e.g. from new race
 * results) fall under the normal large-shift guard at the
 * prescription layer — not this one-time banner.
 */

import { useState } from 'react';

export function PaceMigrationBanner() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/profile/acknowledge-pace-migration', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      // Hard reload so server-side props re-fetch with the ack set
      // (banner disappears, paces re-render).
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="pace-migration-banner"
      style={{
        background: 'linear-gradient(135deg, rgba(232, 93, 38, 0.08), rgba(232, 93, 38, 0.04))',
        border: '1px solid rgba(232, 93, 38, 0.35)',
        borderRadius: 12,
        padding: '16px 18px',
        marginBottom: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
            color: 'var(--accent, #E85D26)',
            textTransform: 'uppercase',
          }}
        >
          ⚙ One-time pace correction
        </div>
      </div>
      <div style={{ fontSize: 14, lineHeight: 1.45, color: 'rgba(13, 15, 18, 0.85)' }}>
        Your training paces have been updated to <strong>canonical Daniels</strong> values from
        the official Table 2 source. The previous formula was derived from race times and
        drifted from the canonical bands — Easy paces ran too slow (over-conservative),
        Repetition paces ran too fast (mile race pace instead of Daniels&apos; R).
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.4, color: 'rgba(13, 15, 18, 0.6)' }}>
        This is a one-time correction. After you confirm, the bands above apply to all
        workouts and the large-shift guard will catch any future changes that exceed
        15s/mi. Review the new bands below, then confirm.
      </div>
      {error ? (
        <div style={{ fontSize: 12, color: '#c92a2a', fontWeight: 600 }}>{error}</div>
      ) : null}
      <div>
        <button
          type="button"
          onClick={confirm}
          disabled={submitting}
          style={{
            background: 'var(--accent, #E85D26)',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: submitting ? 'wait' : 'pointer',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? 'Confirming…' : 'Confirm canonical paces'}
        </button>
      </div>
    </div>
  );
}
