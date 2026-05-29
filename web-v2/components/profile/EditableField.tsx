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
 * #157: also supports a `richSelect` kind for fields that need real
 * descriptions per option (e.g. experience_level). Each option carries a
 * sentence explaining what the pick does to the user's plan.
 *
 * Saves via PATCH /api/profile. router.refresh on success.
 */
export interface RichOption {
  value: string;
  label: string;
  description: string;
}

export function EditableField({
  field, label, currentValue, kind, options = [], richOptions, contextLine, hint, unitLabel, displayMap, displayValue,
}: {
  field: string;
  label: string;
  currentValue: string | number | null;
  kind: 'number' | 'text' | 'select' | 'richSelect';
  options?: string[];
  /** richSelect: array of cards with label + description per choice. */
  richOptions?: RichOption[];
  /** Context line shown when editing a richSelect — "this setting drives …" */
  contextLine?: string;
  hint?: string;
  unitLabel?: string;
  /** Optional display-time mapping (DB value → human label).
   *  e.g. { advanced_plus: 'Sub-elite' }. */
  displayMap?: Record<string, string>;
  /** Optional fully-formatted display string. When set, overrides
   *  the displayed value entirely — useful for unit conversions
   *  (cm→ft/in) or date reformatting (ISO→MM-DD-YYYY) where the
   *  edit input still uses the raw value. */
  displayValue?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(currentValue == null ? '' : String(currentValue));
  const [pending, startPending] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // P-PROFILE-HEIGHT 2026-05-27: dedicated ft + in dual-input for the
  // height_cm field. Single-number cm entry felt wrong (and forced US
  // users to mentally convert). Two fields side-by-side, save converts
  // to cm via *2.54 + rounds. Other number fields stay single-input.
  const isHeight = field === 'height_cm';
  const initialHeight = (() => {
    if (!isHeight || currentValue == null) return { ft: '', inch: '' };
    const cm = Number(currentValue);
    if (!Number.isFinite(cm) || cm <= 0) return { ft: '', inch: '' };
    const totalInches = Math.round(cm / 2.54);
    return { ft: String(Math.floor(totalInches / 12)), inch: String(totalInches % 12) };
  })();
  const [heightFt, setHeightFt] = useState<string>(initialHeight.ft);
  const [heightInch, setHeightInch] = useState<string>(initialHeight.inch);

  function save() {
    setErr(null);
    let send: any;
    if (isHeight) {
      const ft = Number(heightFt);
      const inch = Number(heightInch) || 0;
      if (!Number.isFinite(ft) || ft <= 0) {
        setErr('Enter feet (e.g. 5)'); return;
      }
      if (inch < 0 || inch >= 12) {
        setErr('Inches must be 0–11'); return;
      }
      send = Math.round((ft * 12 + inch) * 2.54);
    } else {
      send = kind === 'number' ? Number(value) : value;
      if (kind === 'number' && (!Number.isFinite(send) || send <= 0)) {
        setErr('Enter a positive number'); return;
      }
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
          <div style={{ fontFamily: 'var(--f-label)', fontSize: 11, color: 'var(--dim)', letterSpacing: '1.2px' }}>
            EDIT
          </div>
        </div>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, color: currentValue == null ? 'var(--dim)' : 'var(--ink)', letterSpacing: '0.5px', lineHeight: 1.1 }}>
          {currentValue == null
            ? '— Add'
            : displayValue
              ? `${displayValue}${unitLabel ? ' ' + unitLabel : ''}`
              : `${displayMap?.[String(currentValue)] ?? currentValue}${unitLabel ? ' ' + unitLabel : ''}`}
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
      <div className="card-eyebrow" style={{ color: 'var(--mute)', marginBottom: 8 }}>
        EDIT {label.toUpperCase()}
      </div>
      {kind === 'richSelect' && richOptions ? (
        <>
          {contextLine && (
            <div style={{
              fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)',
              lineHeight: 1.5, marginBottom: 12,
            }}>
              {contextLine}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {richOptions.map((opt) => {
              const selected = value === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setValue(opt.value)}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: selected ? 'rgba(62,189,65,0.10)' : 'var(--card-2)',
                    border: `1px solid ${selected ? 'var(--green)' : 'var(--line)'}`,
                    cursor: 'pointer',
                    color: 'inherit', font: 'inherit',
                    transition: 'background .12s, border-color .12s',
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
                  }}>
                    <span style={{
                      width: 14, height: 14, borderRadius: '50%',
                      border: `2px solid ${selected ? 'var(--green)' : 'var(--ink-24)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {selected && (
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
                      )}
                    </span>
                    <span style={{
                      fontFamily: 'var(--f-label)', fontSize: 12, letterSpacing: '1px',
                      color: selected ? 'var(--green)' : 'var(--ink)', fontWeight: 700,
                    }}>
                      {opt.label}
                    </span>
                  </div>
                  <div style={{
                    fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)',
                    lineHeight: 1.5, marginLeft: 22,
                  }}>
                    {opt.description}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : kind === 'select' ? (
        <select autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          style={inputStyle()}>
          <option value="">(select)</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : isHeight ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <input
            autoFocus
            type="number"
            min={3} max={8}
            value={heightFt}
            onChange={(e) => setHeightFt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            placeholder="ft"
            style={{ ...inputStyle(), width: 64, textAlign: 'center' }}
          />
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'var(--mute)' }}>ft</span>
          <input
            type="number"
            min={0} max={11}
            value={heightInch}
            onChange={(e) => setHeightInch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            placeholder="in"
            style={{ ...inputStyle(), width: 72, textAlign: 'center' }}
          />
          <span style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'var(--mute)' }}>in</span>
        </div>
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
    background: 'var(--card-2)', border: '1px solid var(--line)',
    borderRadius: 6, padding: '6px 10px', width: '100%',
  };
}
