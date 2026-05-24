'use client';

/**
 * Health · illness logging affordance. Per coach-layer spec §7.5.
 *
 * Quick "report illness" form that POSTs to /api/illness and triggers
 * ILLNESS mode for the coach. Above-the-neck-no-fever rule honored
 * by the coach voice; below-the-neck or fever → rest prescription.
 */

import { useEffect, useState } from 'react';

type IllnessKind = 'cold' | 'flu' | 'gi' | 'fever' | 'covid' | 'other';
type IllnessSeverity = 'mild' | 'moderate' | 'severe';

interface ActiveIllness {
  id: number;
  kind: IllnessKind;
  severity: IllnessSeverity;
  aboveNeck: boolean;
  startDate: string;
}

export function IllnessLogIsland() {
  const [active, setActive] = useState<ActiveIllness | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<IllnessKind>('cold');
  const [severity, setSeverity] = useState<IllnessSeverity>('mild');
  const [aboveNeck, setAboveNeck] = useState(true);
  const [resolveBusy, setResolveBusy] = useState(false);

  useEffect(() => {
    fetch('/api/illness').then((r) => r.json()).then((j: { ok: boolean; active: ActiveIllness | null }) => {
      if (j.ok) setActive(j.active);
    }).catch(() => setActive(null));
  }, []);

  async function logIllness() {
    setBusy(true);
    try {
      const res = await fetch('/api/illness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, severity, aboveNeck }),
      });
      const j: { ok: boolean; illness: ActiveIllness } = await res.json();
      if (j.ok) {
        setActive(j.illness);
        setOpen(false);
      }
    } finally { setBusy(false); }
  }

  async function resolve() {
    if (!active) return;
    setResolveBusy(true);
    try {
      const res = await fetch('/api/illness', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: active.id, resolve: true }),
      });
      if (res.ok) setActive(null);
    } finally { setResolveBusy(false); }
  }

  if (active === undefined) return null;

  const card: React.CSSProperties = {
    background: '#fff',
    borderRadius: 14,
    padding: '16px 18px',
    boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.05)',
    border: active ? '1px solid rgba(252,77,100,.32)' : '1px solid rgba(8,8,8,.08)',
  };

  if (active) {
    return (
      <div style={card}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: '#FC4D64', marginBottom: 8 }}>
          Sick · coach in rest-recovery mode
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#080808', marginBottom: 4 }}>
          {active.kind} · {active.severity} · {active.aboveNeck ? 'above the neck' : 'below the neck'}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(8,8,8,.55)', marginBottom: 12 }}>
          Logged {active.startDate}
        </div>
        <button
          type="button"
          onClick={resolve}
          disabled={resolveBusy}
          style={{
            padding: '8px 14px', borderRadius: 999, border: '1px solid rgba(8,8,8,.2)',
            background: '#fff', cursor: resolveBusy ? 'wait' : 'pointer',
            fontFamily: 'Oswald, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase',
          }}
        >
          {resolveBusy ? 'Saving…' : "Mark recovered"}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div style={card}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(8,8,8,.45)', marginBottom: 6 }}>
          Illness status
        </div>
        <div style={{ fontSize: 14, color: 'rgba(8,8,8,.7)', marginBottom: 12 }}>
          All clear. Log if you come down with something — the coach swaps to rest-or-easy depending on severity.
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: '8px 14px', borderRadius: 999, border: '1px solid rgba(8,8,8,.2)',
            background: '#fff', cursor: 'pointer',
            fontFamily: 'Oswald, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase',
          }}
        >
          Report illness
        </button>
      </div>
    );
  }

  const KIND_LABEL: Record<IllnessKind, string> = {
    cold: 'Cold', flu: 'Flu', gi: 'GI / stomach', fever: 'Fever', covid: 'COVID', other: 'Other',
  };

  return (
    <div style={card}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(8,8,8,.45)', marginBottom: 10 }}>
        Report an illness
      </div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(8,8,8,.6)', marginBottom: 4 }}>WHAT</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {(Object.keys(KIND_LABEL) as IllnessKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            style={{
              padding: '6px 12px', borderRadius: 999,
              border: '1px solid rgba(8,8,8,.18)',
              background: kind === k ? '#080808' : '#fff',
              color: kind === k ? '#fff' : 'rgba(8,8,8,.7)',
              fontFamily: 'Oswald, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(8,8,8,.6)', marginBottom: 4 }}>SEVERITY</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['mild', 'moderate', 'severe'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeverity(s)}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8,
              border: '1px solid rgba(8,8,8,.18)',
              background: severity === s ? '#FC4D64' : '#fff',
              color: severity === s ? '#fff' : 'rgba(8,8,8,.7)',
              fontFamily: 'Oswald, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(8,8,8,.7)', marginBottom: 12, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={aboveNeck}
          onChange={(e) => setAboveNeck(e.target.checked)}
        />
        Above the neck (head cold, sore throat — not in the chest)
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={logIllness}
          disabled={busy}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 999,
            background: '#FC4D64', color: '#fff', border: 'none',
            fontFamily: 'Oswald, sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
            cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? 'Saving…' : 'Log illness'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            padding: '10px 18px', borderRadius: 999,
            background: '#fff', color: 'rgba(8,8,8,.6)',
            border: '1px solid rgba(8,8,8,.2)',
            fontFamily: 'Oswald, sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
