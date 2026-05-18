'use client';

/**
 * Max HR section on /profile.
 *
 * Shows the resolved max HR with provenance:
 *   - "Manual override · 187 bpm"
 *   - "Computed from Big Sur Marathon · 185 bpm (apr 26)"
 *   - "No data yet — sync more Strava activities"
 *
 * Edit button reveals an input that lets the user set or clear the
 * manual override. Saving updates users.max_hr.
 *
 * Once max HR is set, every HR-zone computation across the app
 * (debrief modal, future training-load math) uses real %max instead
 * of qualitative bands.
 */

import { useEffect, useState } from 'react';

interface ComputedSource {
  id: string;
  name: string;
  date: string;
  workoutType: number | null;
  distanceMi: number;
}
interface ComputedMaxHr { value: number; source: ComputedSource }
interface State {
  value: number | null;
  source: 'manual' | 'computed' | 'none';
  computed: ComputedMaxHr | null;
}

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00Z');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function MaxHrIsland() {
  const [state, setState] = useState<State | null>(null);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/profile/max-hr');
      const j = await res.json();
      if (res.ok) setState({ value: j.value, source: j.source, computed: j.computed });
    } catch { /* no-op */ }
  }
  useEffect(() => { load(); }, []);

  async function save(maxHr: number | null) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/profile/max-hr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxHr }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j?.error || 'Save failed');
      } else {
        setState({ value: j.value, source: j.source, computed: j.computed });
        setEditing(false);
        setInput('');
      }
    } catch {
      setErr('Network error');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = parseInt(input, 10);
    if (Number.isFinite(v)) save(v);
  }

  if (!state) {
    return (
      <div className="max-hr-block">
        <span className="max-hr-label">Max HR</span>
        <span className="max-hr-val muted">Loading…</span>
      </div>
    );
  }

  return (
    <div className="max-hr-block">
      <div className="max-hr-top">
        <span className="max-hr-label">Max HR</span>
        {!editing && (
          <button type="button" className="max-hr-edit-btn" onClick={() => { setInput(state.value?.toString() ?? ''); setEditing(true); }}>
            {state.value ? 'Edit' : 'Set manually'}
          </button>
        )}
      </div>

      {!editing && (
        <>
          <div className="max-hr-row">
            <span className="max-hr-val">{state.value ?? '—'}</span>
            {state.value && <span className="max-hr-unit">bpm</span>}
          </div>
          <div className="max-hr-source">
            {state.source === 'manual' && <>Set manually</>}
            {state.source === 'computed' && state.computed && (
              <>
                Peak from <strong>{state.computed.source.name}</strong>
                {state.computed.source.date && <> · {fmtDate(state.computed.source.date)}</>}
                {state.computed.source.workoutType === 1 && ' · race'}
              </>
            )}
            {state.source === 'none' && (
              <>No data — sync a hard workout or set manually</>
            )}
          </div>
          {state.source === 'computed' && state.computed && (
            <button type="button" className="max-hr-confirm-btn" disabled={busy} onClick={() => save(state.computed!.value)}>
              {busy ? 'Saving…' : 'Confirm this'}
            </button>
          )}
        </>
      )}

      {editing && (
        <form onSubmit={onSubmit} className="max-hr-edit">
          <input
            type="number"
            min={100}
            max={230}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. 187"
            className="max-hr-input"
            autoFocus
          />
          <span className="max-hr-unit">bpm</span>
          <button type="submit" className="max-hr-save-btn" disabled={busy}>Save</button>
          <button type="button" className="max-hr-cancel-btn" onClick={() => { setEditing(false); setInput(''); setErr(null); }}>
            Cancel
          </button>
          {state.value && (
            <button type="button" className="max-hr-clear-btn" onClick={() => save(null)} disabled={busy}>
              Clear · use computed
            </button>
          )}
          {err && <span className="max-hr-err">{err}</span>}
        </form>
      )}

      <style jsx>{`
        .max-hr-block {
          padding: 20px 40px 24px;
          border-top: 1px solid var(--divider);
        }
        .max-hr-top {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 8px;
        }
        .max-hr-label {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px;
          color: rgba(13,15,18,.55);
          text-transform: uppercase;
        }
        .max-hr-edit-btn, .max-hr-confirm-btn {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 10.5px; letter-spacing: 1.5px;
          padding: 6px 12px; border-radius: 6px; cursor: pointer;
          background: transparent; color: var(--t1);
          border: 1px solid rgba(13,15,18,.16);
          text-transform: uppercase;
        }
        .max-hr-edit-btn:hover { background: rgba(13,15,18,.04); }
        .max-hr-confirm-btn {
          margin-top: 10px;
          background: var(--green); color: #fff; border-color: var(--green);
        }
        .max-hr-confirm-btn:hover { background: #248F26; }
        .max-hr-row {
          display: flex; align-items: baseline; gap: 6px;
        }
        .max-hr-val {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 38px; line-height: 1;
          color: var(--t0); letter-spacing: -0.5px;
        }
        .max-hr-val.muted { color: rgba(13,15,18,.32); font-size: 22px; }
        .max-hr-unit {
          font-family: 'Inter', sans-serif;
          font-size: 12px; font-weight: 500;
          color: rgba(13,15,18,.55);
          letter-spacing: 0.5px;
        }
        .max-hr-source {
          margin-top: 6px;
          font-family: 'Inter', sans-serif;
          font-size: 12px; color: rgba(13,15,18,.55);
          line-height: 1.5;
        }
        .max-hr-source strong { color: var(--t0); font-weight: 600; }
        .max-hr-edit {
          display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
          margin-top: 8px;
        }
        .max-hr-input {
          font-family: 'Inter', sans-serif;
          font-size: 16px; font-weight: 600;
          width: 90px; padding: 8px 12px;
          border: 1.5px solid rgba(13,15,18,.16);
          border-radius: 8px;
        }
        .max-hr-input:focus {
          outline: none;
          border-color: var(--orange);
        }
        .max-hr-save-btn, .max-hr-cancel-btn, .max-hr-clear-btn {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase;
          padding: 9px 14px; border-radius: 8px; cursor: pointer; border: 1px solid;
        }
        .max-hr-save-btn { background: var(--t0); color: #fff; border-color: var(--t0); }
        .max-hr-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .max-hr-cancel-btn { background: transparent; color: rgba(13,15,18,.55); border-color: rgba(13,15,18,.16); }
        .max-hr-clear-btn { background: transparent; color: #B00020; border-color: rgba(176,0,32,.25); }
        .max-hr-err { color: #B00020; font-size: 12px; }
      `}</style>
    </div>
  );
}
