'use client';

/**
 * /health · HR anchors editor.
 *
 * Shows the two HR anchors that drive every Karvonen zone on this page —
 * Max HR and Resting HR — with their provenance, and lets the runner
 * override either inline. Saving POSTs to the existing endpoints:
 *   POST /api/profile/max-hr      { maxHr }
 *   POST /api/profile/resting-hr  { restingHr }
 *
 * Seeded server-side from the page's resolved fitness so the values are
 * correct on first paint; the inputs re-POST and reload on save. This is
 * a slimmer, self-contained sibling of the profile MaxHrIsland /
 * RestingHrIsland — kept under app/health so the page stays isolated.
 */

import { useState } from 'react';

type Anchor = 'max-hr' | 'resting-hr';

interface AnchorState {
  value: number | null;
  source: string;
  /** Auto (Apple Health / computed) value even when an override wins — for
   *  the "Apple Health now sees N — use it" prompt. */
  autoValue?: number | null;
}

export function HrAnchorsIsland({
  initialMaxHr,
  initialRestingHr,
}: {
  initialMaxHr: AnchorState;
  initialRestingHr: AnchorState;
}) {
  const [maxHr, setMaxHr] = useState<AnchorState>(initialMaxHr);
  const [restingHr, setRestingHr] = useState<AnchorState>(initialRestingHr);

  return (
    <div className="hr-anchors">
      <AnchorEditor
        anchor="max-hr"
        label="Max HR"
        hint="The ceiling — peak heart rate from a terminal effort. Anchors the top of every zone."
        min={120}
        max={230}
        placeholder="e.g. 187"
        state={maxHr}
        onSaved={setMaxHr}
      />
      <AnchorEditor
        anchor="resting-hr"
        label="Resting HR"
        hint="The floor — your true resting beat. Enables Karvonen (%HRR) zones, more accurate for trained runners."
        min={30}
        max={100}
        placeholder="e.g. 52"
        state={restingHr}
        onSaved={setRestingHr}
      />
    </div>
  );
}

function AnchorEditor({
  anchor,
  label,
  hint,
  min,
  max,
  placeholder,
  state,
  onSaved,
}: {
  anchor: Anchor;
  label: string;
  hint: string;
  min: number;
  max: number;
  placeholder: string;
  state: AnchorState;
  onSaved: (s: AnchorState) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const bodyKey = anchor === 'max-hr' ? 'maxHr' : 'restingHr';

  async function save(value: number | null) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/profile/${anchor}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [bodyKey]: value }),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j?.error || 'Save failed');
      } else {
        onSaved({ value: j.value ?? null, source: j.source ?? 'manual', autoValue: j.autoValue ?? null });
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

  const sourceWord =
    state.source === 'manual' ? 'Manual override'
      : state.source === 'auto' ? 'Apple Health · auto'
        : state.source === 'computed' ? 'Computed from activity'
          : 'No data yet';

  // New-peak prompt: a manual override is set, but Apple Health has since
  // observed a HIGHER value — offer to switch back to auto.
  const showNewPeak =
    state.source === 'manual' && state.value != null &&
    state.autoValue != null && state.autoValue > state.value;

  return (
    <div className="hr-anchor">
      <div className="hr-anchor-top">
        <span className="hr-anchor-label">{label}</span>
        {!editing && (
          <button
            type="button"
            className="hr-anchor-edit"
            onClick={() => { setInput(state.value?.toString() ?? ''); setEditing(true); }}
          >
            {state.value != null ? 'Edit' : 'Set'}
          </button>
        )}
      </div>

      {!editing ? (
        <>
          <div className="hr-anchor-row">
            <span className="hr-anchor-val">{state.value ?? '—'}</span>
            {state.value != null && <span className="hr-anchor-unit">bpm</span>}
          </div>
          <div className="hr-anchor-source">{sourceWord}</div>
          {showNewPeak ? (
            <button type="button" className="hr-anchor-newpeak" onClick={() => save(null)} disabled={busy}>
              Apple Health now sees {state.autoValue} bpm — use it
            </button>
          ) : (
            <div className="hr-anchor-hint">{hint}</div>
          )}
        </>
      ) : (
        <form onSubmit={onSubmit} className="hr-anchor-edit-form">
          <div className="hr-anchor-edit-inputs">
            <input
              type="number"
              min={min}
              max={max}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={placeholder}
              className="hr-anchor-input"
              autoFocus
            />
            <span className="hr-anchor-unit">bpm</span>
            <button type="submit" className="hr-anchor-save" disabled={busy}>
              {busy ? '…' : 'Save'}
            </button>
            <button
              type="button"
              className="hr-anchor-cancel"
              onClick={() => { setEditing(false); setInput(''); setErr(null); }}
            >
              Cancel
            </button>
            {state.value != null && (
              <button
                type="button"
                className="hr-anchor-clear"
                onClick={() => save(null)}
                disabled={busy}
              >
                Clear
              </button>
            )}
          </div>
          {err && <span className="hr-anchor-err">{err}</span>}
        </form>
      )}
    </div>
  );
}
