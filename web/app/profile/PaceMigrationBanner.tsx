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

/** Optional before/after data showing the user exactly what changed.
 *  Pass paces in seconds/mile so the banner formats them. Renders a
 *  compact two-column comparison ("Previous / Now") with deltas, per
 *  David's N10 spec — makes the migration feel like a deliberate edit
 *  rather than a silent shift. */
export interface BeforeAfter {
  legacyE?: number;  // s/mi
  legacyT?: number;
  legacyI?: number;
  legacyR?: number;
  newE?: number;
  newT?: number;
  newI?: number;
  newR?: number;
  vdot?: number;
}

function fmtPace(s?: number): string {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtDelta(prev?: number, curr?: number): { label: string; tone: 'faster' | 'slower' | 'same' } {
  if (!prev || !curr) return { label: '', tone: 'same' };
  const d = curr - prev;
  if (Math.abs(d) < 1) return { label: 'same', tone: 'same' };
  return {
    label: d < 0 ? `${-d}s faster` : `${d}s slower`,
    tone: d < 0 ? 'faster' : 'slower',
  };
}

export function PaceMigrationBanner({ beforeAfter }: { beforeAfter?: BeforeAfter } = {}) {
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
      {/* V4 / N10 polish: show specific before/after pace numbers if
          provided. Makes the migration feel like a deliberate edit
          rather than a silent shift. */}
      {beforeAfter && (beforeAfter.newE || beforeAfter.newT || beforeAfter.newI || beforeAfter.newR) && (
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.5)',
            border: '1px solid rgba(13, 15, 18, 0.08)',
            borderRadius: 8,
            padding: '10px 12px',
            fontFamily: 'Inter, sans-serif',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'rgba(13, 15, 18, 0.75)',
          }}
        >
          <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 9, letterSpacing: 1.2, color: 'rgba(13, 15, 18, 0.55)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 700 }}>
            Before / after · VDOT {beforeAfter.vdot?.toFixed(1) ?? '—'}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
            <thead>
              <tr style={{ color: 'rgba(13, 15, 18, 0.50)' }}>
                <th style={{ textAlign: 'left', padding: '2px 0', fontWeight: 600 }}>Zone</th>
                <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 600 }}>Previous (buggy)</th>
                <th style={{ textAlign: 'left', padding: '2px 6px', fontWeight: 600 }}>Now (canonical)</th>
                <th style={{ textAlign: 'left', padding: '2px 0', fontWeight: 600 }}>Δ</th>
              </tr>
            </thead>
            <tbody style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {([
                ['E', beforeAfter.legacyE, beforeAfter.newE],
                ['T', beforeAfter.legacyT, beforeAfter.newT],
                ['I', beforeAfter.legacyI, beforeAfter.newI],
                ['R', beforeAfter.legacyR, beforeAfter.newR],
              ] as Array<['E' | 'T' | 'I' | 'R', number?, number?]>).map(([zone, prev, curr]) => {
                const d = fmtDelta(prev, curr);
                const color = d.tone === 'faster' ? '#1f6a21' : d.tone === 'slower' ? '#b3450a' : 'rgba(13,15,18,.50)';
                return (
                  <tr key={zone}>
                    <td style={{ padding: '2px 0', fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>{zone}</td>
                    <td style={{ padding: '2px 6px', color: 'rgba(13,15,18,.55)' }}>{fmtPace(prev)}/mi</td>
                    <td style={{ padding: '2px 6px' }}>{fmtPace(curr)}/mi</td>
                    <td style={{ padding: '2px 0', color }}>{d.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
