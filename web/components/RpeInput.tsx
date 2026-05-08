/**
 * RpeInput — "How did that feel?" post-workout effort logger.
 *
 * Borg CR-10 / 1-10 RPE scale. Saves to /api/rpe (workout_rpe table).
 * After saving, bumps the hub cache so other tiles re-render with
 * the new RPE history.
 *
 * UX: 10 buttons in a horizontal row, current value highlighted.
 * Tap = instant save (no confirm). Same-day re-tap overwrites.
 * Optional notes field appears after the rating is set.
 *
 * Doctrine: Research/00b §INCOMPLETE_RECOVERY_QUALITATIVE_SIGNALS —
 * RPE drift between sessions of similar prescribed effort flags
 * fatigue accumulation. The engine consumes this once enough data
 * is gathered.
 */

'use client';

import { useState } from 'react';
import { useHubContext } from '../lib/hub-provider';
import type { WorkoutRpe } from '../lib/rpe-store';

interface Props {
  /** ISO YYYY-MM-DD. Usually the runner is logging "today" but the
   *  caller can pre-fill yesterday for "log yesterday's run" UX. */
  workoutDate: string;
  /** Existing entry, if the runner has already logged for this date.
   *  Pre-fills the rating + notes; tap overwrites. */
  existing?: WorkoutRpe | null;
  /** Compact rendering — drop the explanatory body and the descriptor
   *  legend, just show the rating row. Used in dense tile layouts. */
  compact?: boolean;
}

const RPE_LABELS: Record<number, string> = {
  1:  'Barely working',
  2:  'Very easy',
  3:  'Easy',
  4:  'Steady',
  5:  'Moderate',
  6:  'Comfortable hard',
  7:  'Hard',
  8:  'Very hard',
  9:  'Near max',
  10: 'Max effort',
};

const RPE_COLORS: Record<number, string> = {
  1:  'var(--color-success)',
  2:  'var(--color-success)',
  3:  'var(--color-success)',
  4:  'var(--color-corporate)',
  5:  'var(--color-corporate)',
  6:  'var(--color-attention)',
  7:  'var(--color-attention)',
  8:  'var(--color-warning)',
  9:  'var(--color-warning)',
  10: 'var(--color-warning)',
};

export function RpeInput({ workoutDate, existing = null, compact = false }: Props) {
  const { refresh } = useHubContext();
  const [rpe, setRpe] = useState<number | null>(existing?.rpe ?? null);
  const [notes, setNotes] = useState<string>(existing?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(existing?.recordedAt ?? null);

  async function persist(rpeVal: number, notesVal: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/rpe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workoutDate, rpe: rpeVal, notes: notesVal || null }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `RPE save failed (${res.status})`);
      }
      const j = await res.json() as { ok: true; entry: WorkoutRpe };
      setSavedAt(j.entry.recordedAt);
      // Refresh the hub so other tiles see the new entry. The hub
      // reads workout_rpe directly via getRecentRpe, so this is
      // the canonical propagation path.
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onPick(n: number) {
    setRpe(n);
    await persist(n, notes);
  }

  async function onNotesBlur() {
    if (rpe == null) return;
    if ((existing?.notes ?? '') === notes) return;  // no change
    await persist(rpe, notes);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!compact && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="tile-sub" style={{ color: 'var(--color-attention)' }}>
            How did that feel?
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-t2)', lineHeight: 1.5 }}>
            Tap a number — Borg 1 (barely working) → 10 (max effort). The coach uses this to spot fatigue drift over time.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 4 }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => {
          const active = rpe === n;
          return (
            <button
              key={n}
              type="button"
              disabled={saving}
              onClick={() => onPick(n)}
              title={RPE_LABELS[n]}
              style={{
                padding: '10px 0',
                borderRadius: 6,
                border: active ? `2px solid ${RPE_COLORS[n]}` : '1px solid var(--color-l4)',
                background: active ? RPE_COLORS[n] : 'var(--color-l2)',
                color: active ? '#fff' : 'var(--color-t1)',
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: 800,
                cursor: saving ? 'wait' : 'pointer',
                fontVariantNumeric: 'tabular-nums',
                opacity: saving ? 0.6 : 1,
                transition: 'all 0.15s',
              }}
            >
              {n}
            </button>
          );
        })}
      </div>

      {rpe != null && (
        <div style={{
          fontFamily: 'var(--font-data)', fontSize: 10.5, fontWeight: 700,
          letterSpacing: '1.4px', color: RPE_COLORS[rpe],
          textTransform: 'uppercase',
        }}>
          {rpe} / 10 · {RPE_LABELS[rpe]}
        </div>
      )}

      {rpe != null && !compact && (
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={onNotesBlur}
          placeholder="Optional · what stood out? (energy, weather, soreness…)"
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--color-l4)',
            background: 'var(--color-l2)',
            color: 'var(--color-t1)',
            fontFamily: 'var(--font-body, system-ui)',
            fontSize: 12,
            resize: 'vertical',
            minHeight: 50,
          }}
        />
      )}

      {error && (
        <div style={{ fontSize: 11, color: 'var(--color-warning)', fontStyle: 'italic' }}>
          {error}
        </div>
      )}

      {savedAt && !error && !saving && (
        <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--color-t3)' }}>
          SAVED · {new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}
