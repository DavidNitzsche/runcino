'use client';

/**
 * GoalEditIsland — inline-editable Goal Time in the race plan hero.
 *
 * Renders as a normal stat tile until clicked, then becomes an input
 * that accepts H:MM:SS or M:SS. On save, POSTs the new goal time to
 * /api/races/[slug]/rebuild, which re-runs the pacing pipeline and
 * persists the updated plan. The page then router.refresh()es so
 * every dependent value (phase paces, cumulative times, coach take,
 * predicted-vs-target gap) updates from the fresh plan.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  slug: string;
  goalDisplay: string;
  goalFinishS: number;
  raceDistanceMi: number;
}

function parseGoalInput(input: string): number | null {
  // Accept H:MM:SS, MM:SS, or just total seconds. Returns total seconds.
  const trimmed = input.trim();
  const parts = trimmed.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}
function fmtPace(sPerMi: number): string {
  if (!sPerMi || sPerMi <= 0) return '—';
  const m = Math.floor(sPerMi / 60);
  const s = sPerMi % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function GoalEditIsland({ slug, goalDisplay, goalFinishS, raceDistanceMi }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(goalDisplay);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const parsed = parseGoalInput(input);
    if (parsed === null || parsed < 60 * 5 || parsed > 24 * 3600) {
      setErr('Enter a time like 1:35:00 (H:MM:SS)');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/races/${slug}/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goalFinishS: parsed }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j?.error || `Rebuild failed (${res.status})`);
        setBusy(false);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setErr('Network error');
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="path-stat path-stat-editing">
        <div className="path-stat-label">Goal Time</div>
        <form onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input
            type="text"
            className="goal-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="1:35:00"
            autoFocus
            disabled={busy}
          />
          <div className="goal-edit-actions">
            <button type="submit" className="goal-save-btn" disabled={busy}>
              {busy ? 'Rebuilding…' : 'Save'}
            </button>
            <button type="button" className="goal-cancel-btn" onClick={() => { setEditing(false); setErr(null); setInput(goalDisplay); }} disabled={busy}>
              Cancel
            </button>
          </div>
          {err && <div className="goal-err">{err}</div>}
        </form>
        <style jsx>{`
          .goal-input {
            font-family: 'Bebas Neue', sans-serif;
            font-size: 36px;
            line-height: 1;
            width: 100%;
            padding: 2px 0;
            border: none;
            border-bottom: 2px solid #E85D26;
            background: transparent;
            color: #080808;
            margin-top: 6px;
            letter-spacing: 0;
          }
          .goal-input:focus { outline: none; }
          .goal-edit-actions {
            display: flex; gap: 6px; margin-top: 12px;
          }
          .goal-save-btn, .goal-cancel-btn {
            font-family: 'Oswald', sans-serif; font-weight: 600;
            font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
            padding: 7px 12px; border-radius: 6px; cursor: pointer;
            border: 1px solid;
          }
          .goal-save-btn { background: #080808; color: #fff; border-color: #080808; }
          .goal-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .goal-cancel-btn { background: transparent; color: rgba(8,8,8,.55); border-color: rgba(8,8,8,.16); }
          .goal-err {
            font-family: 'Inter', sans-serif; font-size: 11px; color: #B00020;
            margin-top: 6px;
          }
        `}</style>
      </div>
    );
  }

  const avgPaceSPerMi = goalFinishS > 0 && raceDistanceMi > 0 ? Math.round(goalFinishS / raceDistanceMi) : 0;

  return (
    <button type="button" className="path-stat path-stat-btn" onClick={() => setEditing(true)} title="Click to edit goal time">
      <div className="path-stat-label">Goal Time</div>
      <div className="path-stat-value">{goalDisplay}</div>
      <div className="path-stat-sub">
        {avgPaceSPerMi > 0 ? <>{fmtPace(avgPaceSPerMi)}/mi avg · <em style={{ fontStyle: 'normal', color: '#E85D26', fontWeight: 600 }}>tap to edit</em></> : 'tap to edit'}
      </div>
      <style jsx>{`
        button.path-stat-btn {
          all: unset;
          display: block;
          cursor: pointer;
          background: rgba(8,8,8,.04);
          border: 1px solid rgba(8,8,8,.08);
          border-radius: 10px;
          padding: 18px 22px;
          transition: background 120ms ease, border-color 120ms ease;
          width: 100%;
        }
        button.path-stat-btn:hover {
          background: rgba(232,128,33,.06);
          border-color: rgba(232,128,33,.30);
        }
      `}</style>
    </button>
  );
}
