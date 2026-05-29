'use client';

/**
 * InlineGapEditor — generic, on-card gap filler. Replaces the height-only
 * ProfileGapInput logic for the today-page COACH NEEDS card.
 *
 * Handles any profile field the coach might ask for:
 *   - height_cm    → number w/ cm/in toggle
 *   - birthday     → date picker
 *   - lthr         → bpm number
 *   - hrmax_observed → bpm number
 *   - experience_level → select (beginner/intermediate/advanced/advanced_plus)
 *   - sex          → select (Male/Female/Other)
 *   - city         → text
 *   - age          → number (legacy; we prefer birthday now)
 *
 * Defensive defaults so a malformed LLM payload never crashes the card —
 * the user just gets "Coach is looking for some detail" with an Add button.
 */
import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface FieldSpec {
  label: string;
  why: string;
  kind: 'number' | 'text' | 'date' | 'select';
  unit?: string;            // e.g. "bpm", "cm"
  options?: string[];       // for select
  toggleUnits?: ['cm','in'] | null;
  validate?: (v: string) => string | null; // returns error or null
  transform?: (v: string, unit: string) => any; // returns value to PATCH
}

const SPECS: Record<string, FieldSpec> = {
  height_cm: {
    label: 'Height', why: 'Unlocks cadence target (180 spm baseline)',
    kind: 'number', toggleUnits: ['cm', 'in'],
    validate: (v) => {
      const n = Number(v);
      if (!isFinite(n) || n <= 0) return 'enter a number';
      return null;
    },
    transform: (v, u) => u === 'in' ? Math.round(Number(v) * 2.54) : Math.round(Number(v)),
  },
  birthday: {
    label: 'Birthday', why: 'Unlocks age-based recovery + heat adjustments',
    kind: 'date',
    validate: (v) => !v ? 'pick a date' : null,
    transform: (v) => v,
  },
  lthr: {
    label: 'LTHR (threshold HR)', why: 'Primary HR-zone anchor (Friel method)',
    kind: 'number', unit: 'bpm',
    validate: (v) => {
      const n = Number(v);
      if (!isFinite(n) || n < 100 || n > 210) return '100–210 bpm';
      return null;
    },
    transform: (v) => Math.round(Number(v)),
  },
  hrmax_observed: {
    label: 'Max HR', why: 'Falls back to %MHR zones if LTHR unknown',
    kind: 'number', unit: 'bpm',
    validate: (v) => {
      const n = Number(v);
      if (!isFinite(n) || n < 140 || n > 230) return '140–230 bpm';
      return null;
    },
    transform: (v) => Math.round(Number(v)),
  },
  experience_level: {
    label: 'Experience level', why: 'Caps weekly mileage to a safe ceiling',
    kind: 'select', options: ['beginner', 'intermediate', 'advanced', 'advanced_plus'],
    validate: () => null,
    transform: (v) => v,
  },
  sex: {
    label: 'Sex', why: 'Heat + recovery adjustments differ by sex',
    kind: 'select', options: ['Male', 'Female', 'Other'],
    validate: () => null,
    transform: (v) => v,
  },
  city: {
    label: 'City', why: 'Weather + race-day timezone',
    kind: 'text',
    validate: (v) => !v.trim() ? 'enter a city' : null,
    transform: (v) => v.trim(),
  },
  age: {
    label: 'Age', why: 'Use Birthday instead — it auto-updates each year',
    kind: 'number',
    validate: (v) => {
      const n = Number(v);
      if (!isFinite(n) || n < 8 || n > 120) return '8–120';
      return null;
    },
    transform: (v) => Math.round(Number(v)),
  },
};

export function InlineGapEditor({ field, fallbackWhy }: { field: string; fallbackWhy?: string | null }) {
  // Defensive: if field is unknown, render an honest "Coach needs detail"
  // card linking to /profile. Never crash.
  const spec = SPECS[field];
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<'cm' | 'in'>('cm');
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => { /* reset on field change */ setValue(''); setError(null); setAck(null); }, [field]);

  if (!spec) {
    // Unknown field — fall back to a quiet hint with link to /profile.
    return (
      <div className="card" style={{
        padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
        border: '1px solid rgba(243,173,56,0.25)', background: 'rgba(243,173,56,0.04)',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, fontWeight: 700, color: 'var(--goal)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 4 }}>COACH NEEDS</div>
          <div style={{ fontFamily: 'var(--f-label)', fontSize: 16, color: 'var(--ink)' }}>{prettify(field)}</div>
          {fallbackWhy && (
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>{fallbackWhy}</div>
          )}
        </div>
        <a href="/profile" style={{
          background: 'var(--goal)', color: '#1a1300', borderRadius: 999,
          padding: '7px 14px', fontFamily: 'var(--f-label)', fontSize: 12, letterSpacing: '1px', fontWeight: 700,
          textDecoration: 'none',
        }}>EDIT IN PROFILE →</a>
      </div>
    );
  }

  async function submit() {
    setError(null); setAck(null);
    const err = spec.validate?.(value) ?? null;
    if (err) { setError(err); return; }
    const v = spec.transform?.(value, unit) ?? value;
    startTransition(async () => {
      try {
        const res = await fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: v }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(j.error ?? 'save failed');
          return;
        }
        setAck('Saved. Coach will pick it up.');
        router.refresh();
      } catch (e: any) {
        setError(e.message ?? 'network error');
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="card"
        style={{
          padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
          textAlign: 'left', cursor: 'pointer', width: '100%',
          border: '1px solid rgba(243,173,56,0.40)', background: 'rgba(243,173,56,0.07)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, fontWeight: 700, color: 'var(--goal)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 4 }}>COACH NEEDS</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--ink)' }}>{spec.label}</div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>{spec.why}</div>
        </div>
        <span style={{
          background: 'var(--goal)', color: '#1a1300', borderRadius: 999,
          padding: '7px 14px', fontFamily: 'var(--f-label)', fontSize: 12, letterSpacing: '1px', fontWeight: 700,
        }}>+ ADD</span>
      </button>
    );
  }

  return (
    <div className="card" style={{
      padding: '14px 18px',
      border: '1px solid var(--green)',
      background: 'rgba(62,189,65,0.05)',
    }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--mute)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 8 }}>
        ADD {spec.label.toUpperCase()}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {spec.kind === 'select' && spec.options ? (
          <select autoFocus value={value} onChange={(e) => setValue(e.target.value)} style={inputStyle()}>
            <option value="">— select —</option>
            {spec.options.map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
          </select>
        ) : (
          <input
            autoFocus
            type={spec.kind === 'number' ? 'number' : spec.kind === 'date' ? 'date' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={spec.kind === 'date' ? 'YYYY-MM-DD' : ''}
            style={inputStyle()}
          />
        )}

        {spec.toggleUnits && (
          <div style={{ display: 'flex', gap: 4 }}>
            {spec.toggleUnits.map((u) => (
              <button key={u} onClick={() => setUnit(u as 'cm' | 'in')}
                style={{
                  background: unit === u ? 'rgba(62,189,65,0.18)' : 'transparent',
                  border: `1px solid ${unit === u ? 'var(--green)' : 'var(--line)'}`,
                  color: unit === u ? 'var(--green)' : 'var(--mute)',
                  borderRadius: 6, padding: '4px 10px',
                  fontFamily: 'var(--f-label)', fontSize: 10, letterSpacing: '1px', cursor: 'pointer',
                }}>{u.toUpperCase()}</button>
            ))}
          </div>
        )}
        {spec.unit && !spec.toggleUnits && (
          <span style={{ color: 'var(--mute)', fontSize: 12 }}>{spec.unit}</span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          onClick={submit}
          disabled={pending || !value}
          style={{
            background: 'var(--green)', color: '#001', border: 'none', borderRadius: 8,
            padding: '8px 16px', fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1.2px',
            cursor: pending || !value ? 'default' : 'pointer', opacity: !value ? 0.5 : 1,
          }}>
          {pending ? 'SAVING…' : 'SAVE'}
        </button>
        <button onClick={() => { setOpen(false); setValue(''); setError(null); setAck(null); }}
          style={{
            background: 'transparent', color: 'var(--mute)', border: '1px solid var(--line)',
            borderRadius: 8, padding: '8px 14px', fontFamily: 'var(--f-label)', fontSize: 11,
            letterSpacing: '1.2px', cursor: 'pointer',
          }}>
          CANCEL
        </button>
      </div>

      {error && (
        <div style={{ color: 'var(--over)', fontSize: 11, marginTop: 8 }}>{error}</div>
      )}
      {ack && (
        <div style={{ color: 'var(--green)', fontSize: 11, marginTop: 8, fontStyle: 'italic' }}>{ack}</div>
      )}
    </div>
  );
}

function prettify(s: string): string {
  if (!s) return 'A profile detail';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function inputStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--ink)',
    background: 'var(--card-2)', border: '1px solid var(--line)',
    borderRadius: 8, padding: '8px 12px', minWidth: 160, letterSpacing: '0.5px',
  };
}
