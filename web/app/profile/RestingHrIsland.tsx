'use client';

/**
 * Resting HR section on /profile.
 *
 * Until we have a Strava / wearable producer for resting HR, this is
 * the user's manual override. Saving stores into users.resting_hr;
 * the fitness resolver picks it up so freshness math and goal-pace
 * adjustments can use it.
 *
 * Modeled after MaxHrIsland.tsx — same shape and styling.
 */

import { useEffect, useState } from 'react';

interface State {
  value: number | null;
  source: 'manual' | 'none';
}

export function RestingHrIsland() {
  const [state, setState] = useState<State | null>(null);
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch('/api/profile/resting-hr');
      const j = await res.json();
      if (res.ok) setState({ value: j.value, source: j.source });
    } catch { /* no-op */ }
  }
  useEffect(() => { load(); }, []);

  async function save(rhr: number | null) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/profile/resting-hr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restingHr: rhr }),
      });
      const j = await res.json();
      if (!res.ok) setErr(j?.error || 'Save failed');
      else {
        setState({ value: j.value, source: j.source });
        setEditing(false);
        setInput('');
      }
    } catch { setErr('Network error'); }
    finally { setBusy(false); }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = parseInt(input, 10);
    if (Number.isFinite(v)) save(v);
  }

  if (!state) {
    return (
      <div className="resting-hr-block">
        <span className="rhr-label">Resting HR</span>
        <span className="rhr-val muted">Loading…</span>
      </div>
    );
  }

  return (
    <div className="resting-hr-block">
      <div className="rhr-top">
        <span className="rhr-label">Resting HR</span>
        {!editing && (
          <button type="button" className="rhr-edit-btn" onClick={() => { setInput(state.value?.toString() ?? ''); setEditing(true); }}>
            {state.value ? 'Edit' : 'Set manually'}
          </button>
        )}
      </div>

      {!editing && (
        <>
          <div className="rhr-row">
            <span className="rhr-val">{state.value ?? '—'}</span>
            {state.value && <span className="rhr-unit">bpm</span>}
          </div>
          <div className="rhr-source">
            {state.source === 'manual' && <>Set manually</>}
            {state.source === 'none' && (
              <>
                No data yet — once set, the coach uses it for freshness
                tracking (rising RHR = accumulating fatigue) and goal-
                pace nudges. Wearable-based auto-compute is coming.
              </>
            )}
          </div>
        </>
      )}

      {editing && (
        <form onSubmit={onSubmit} className="rhr-edit">
          <input
            type="number"
            min={30}
            max={100}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. 52"
            className="rhr-input"
            autoFocus
          />
          <span className="rhr-unit">bpm</span>
          <button type="submit" className="rhr-save-btn" disabled={busy}>Save</button>
          <button type="button" className="rhr-cancel-btn" onClick={() => { setEditing(false); setInput(''); setErr(null); }}>
            Cancel
          </button>
          {state.value && (
            <button type="button" className="rhr-clear-btn" onClick={() => save(null)} disabled={busy}>
              Clear
            </button>
          )}
          {err && <span className="rhr-err">{err}</span>}
        </form>
      )}

      <style jsx>{`
        .resting-hr-block {
          padding: 20px 40px 24px;
          border-top: 1px solid rgba(8,8,8,.06);
        }
        .rhr-top {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 8px;
        }
        .rhr-label {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 11px; letter-spacing: 1.5px;
          color: rgba(8,8,8,.55);
          text-transform: uppercase;
        }
        .rhr-edit-btn {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 10.5px; letter-spacing: 1.5px;
          padding: 6px 12px; border-radius: 6px; cursor: pointer;
          background: transparent; color: #080808;
          border: 1px solid rgba(8,8,8,.18);
          text-transform: uppercase;
        }
        .rhr-edit-btn:hover { background: rgba(8,8,8,.04); }
        .rhr-row {
          display: flex; align-items: baseline; gap: 8px;
          font-family: 'Bebas Neue', sans-serif;
        }
        .rhr-val {
          font-size: 40px; line-height: 1; color: #080808;
          letter-spacing: 0;
        }
        .rhr-val.muted { color: rgba(8,8,8,.32); }
        .rhr-unit {
          font-family: 'Inter', sans-serif; font-size: 13px;
          color: rgba(8,8,8,.55);
        }
        .rhr-source {
          font-family: 'Inter', sans-serif; font-size: 13px;
          color: rgba(8,8,8,.55); margin-top: 6px;
        }
        .rhr-edit {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        }
        .rhr-input {
          font-family: 'Bebas Neue', sans-serif; font-size: 28px;
          width: 100px; padding: 4px 0;
          border: none; border-bottom: 2px solid #E85D26;
          background: transparent; color: #080808;
        }
        .rhr-input:focus { outline: none; }
        .rhr-save-btn, .rhr-cancel-btn, .rhr-clear-btn {
          font-family: 'Oswald', sans-serif; font-weight: 600;
          font-size: 10px; letter-spacing: 1.5px;
          padding: 7px 12px; border-radius: 6px; cursor: pointer;
          border: 1px solid;
          text-transform: uppercase;
        }
        .rhr-save-btn { background: #080808; color: #fff; border-color: #080808; }
        .rhr-cancel-btn { background: transparent; color: rgba(8,8,8,.55); border-color: rgba(8,8,8,.16); }
        .rhr-clear-btn { background: transparent; color: rgba(8,8,8,.55); border-color: rgba(8,8,8,.16); }
        .rhr-err {
          font-family: 'Inter', sans-serif; font-size: 12px; color: #FC4D64;
          flex-basis: 100%;
        }
      `}</style>
    </div>
  );
}
