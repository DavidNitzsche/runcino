'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Generalized profile field editor. Any allowlisted field (height_cm,
 * sex, age, city) becomes inline-editable.
 *
 *   <EditableField field="age" label="Age" currentValue={40} kind="number" />
 *   <EditableField field="city" label="City" currentValue="Los Angeles" kind="text" />
 *   <EditableField field="sex" label="Sex" currentValue="Male" kind="select" options={['Male','Female','Other']} />
 *
 * Saves via PATCH /api/profile. router.refresh on success.
 */
export function EditableField({
  field, label, currentValue, kind, options = [], hint, unitLabel,
}: {
  field: string;
  label: string;
  currentValue: string | number | null;
  kind: 'number' | 'text' | 'select';
  options?: string[];
  hint?: string;
  unitLabel?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(currentValue == null ? '' : String(currentValue));
  const [pending, startPending] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    const send: any = kind === 'number' ? Number(value) : value;
    if (kind === 'number' && (!Number.isFinite(send) || send <= 0)) {
      setErr('Enter a positive number'); return;
    }
    startPending(async () => {
      try {
        const r = await fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: send }),
        });
        const data = await r.json();
        if (!r.ok) { setErr(data.error ?? 'Save failed'); return; }
        setEditing(false);
        router.refresh();
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    });
  }

  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="card"
        style={{
          padding: '18px 22px',
          textAlign: 'left',
          cursor: 'pointer',
          display: 'block', width: '100%',
        }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 8, fontWeight: 700 }}>
            {label}
          </div>
          <div style={{ fontFamily: 'var(--f-label)', fontSize: 11, color: 'rgba(246,247,248,0.50)', letterSpacing: '1.2px' }}>
            EDIT
          </div>
        </div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: currentValue == null ? 'rgba(246,247,248,0.45)' : 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1.1 }}>
          {currentValue == null ? '— Add' : `${currentValue}${unitLabel ? ' ' + unitLabel : ''}`}
        </div>
        {hint && <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--green)', marginTop: 6, letterSpacing: '1px' }}>{hint}</div>}
      </button>
    );
  }

  return (
    <div className="card" style={{
      padding: '14px 16px',
      border: '1px solid var(--green)',
      background: 'rgba(62,189,65,0.04)',
    }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 8 }}>
        EDIT {label.toUpperCase()}
      </div>
      {kind === 'select' ? (
        <select autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          style={inputStyle()}>
          <option value="">(select)</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          autoFocus
          type={kind === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          placeholder={String(currentValue ?? '')}
          style={inputStyle()}
        />
      )}
      {err && <div style={{ color: 'var(--over)', fontSize: 11, marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button onClick={save} disabled={pending || !value} style={{
          background: 'var(--green)', color: '#001', border: 'none', borderRadius: 6,
          padding: '6px 12px', fontFamily: 'var(--f-label)', fontSize: 11,
          letterSpacing: '1px', cursor: pending || !value ? 'default' : 'pointer',
          opacity: !value ? 0.5 : 1,
        }}>{pending ? '…' : 'SAVE'}</button>
        <button onClick={() => { setEditing(false); setErr(null); setValue(String(currentValue ?? '')); }}
          style={{
            background: 'transparent', border: '1px solid var(--line)', color: 'var(--mute)',
            borderRadius: 6, padding: '6px 10px', fontFamily: 'var(--f-label)', fontSize: 11,
            letterSpacing: '1px', cursor: 'pointer',
          }}>CANCEL</button>
      </div>
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--ink)',
    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)',
    borderRadius: 6, padding: '6px 10px', width: '100%',
  };
}
