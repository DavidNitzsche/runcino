'use client';

/**
 * Health · injury logging affordance. Per coach-layer spec §7.4.
 *
 * Quick "report an injury" form that POSTs to /api/injury and triggers
 * INJURY mode for the coach. When active, ActiveModeBanner (in
 * app/layout) surfaces the banner on every page, the coach gates
 * prescriptions through injury_return.ts doctrine, and PROJECTION
 * pauses until resolved.
 *
 * Lightweight by design — body site as a free-text input (no body-
 * diagram primitive built yet), severity as a 3-button toggle, optional
 * notes. The full body-diagram + return-protocol picker lands in a
 * follow-up pass when the design exists.
 */

import { useEffect, useState } from 'react';

interface ActiveInjury {
  id: number;
  site: string;
  severity: 'minor' | 'moderate' | 'major';
  startDate: string;
  expectedReturnDate: string | null;
  returnProtocol: string | null;
}

export function InjuryLogIsland() {
  const [active, setActive] = useState<ActiveInjury | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [site, setSite] = useState('');
  const [severity, setSeverity] = useState<'minor' | 'moderate' | 'major'>('minor');
  const [notes, setNotes] = useState('');
  const [resolveBusy, setResolveBusy] = useState(false);

  useEffect(() => {
    fetch('/api/injury').then((r) => r.json()).then((j: { ok: boolean; active: ActiveInjury | null }) => {
      if (j.ok) setActive(j.active);
    }).catch(() => setActive(null));
  }, []);

  async function logInjury() {
    if (!site.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/injury', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site: site.trim(), severity, notes: notes.trim() || undefined }),
      });
      const j: { ok: boolean; injury: ActiveInjury } = await res.json();
      if (j.ok) {
        setActive(j.injury);
        setOpen(false);
        setSite(''); setSeverity('minor'); setNotes('');
      }
    } finally { setBusy(false); }
  }

  async function resolve() {
    if (!active) return;
    setResolveBusy(true);
    try {
      const res = await fetch('/api/injury', {
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
    border: active ? '1px solid rgba(232,128,33,.32)' : '1px solid rgba(8,8,8,.08)',
  };

  if (active) {
    return (
      <div style={card}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: '#E85D26', marginBottom: 8 }}>
          Active injury · coach in return-protocol mode
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#080808', marginBottom: 4 }}>
          {active.site} · {active.severity}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(8,8,8,.55)', marginBottom: 12 }}>
          Logged {active.startDate}{active.expectedReturnDate ? ` · expected back ${active.expectedReturnDate}` : ''}
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
          {resolveBusy ? 'Saving…' : 'Mark resolved'}
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div style={card}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(8,8,8,.45)', marginBottom: 6 }}>
          Injury status
        </div>
        <div style={{ fontSize: 14, color: 'rgba(8,8,8,.7)', marginBottom: 12 }}>
          Nothing flagged. Log one if something starts barking — the coach pauses goal pressure and gates prescriptions through the return protocol.
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
          Report injury
        </button>
      </div>
    );
  }

  return (
    <div style={card}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(8,8,8,.45)', marginBottom: 10 }}>
        Report an injury
      </div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(8,8,8,.6)', marginBottom: 4 }}>WHERE</label>
      <input
        type="text"
        value={site}
        onChange={(e) => setSite(e.target.value)}
        placeholder="calf · hamstring · IT band · …"
        style={{
          width: '100%', padding: 10, marginBottom: 12, fontSize: 14,
          border: '1px solid rgba(8,8,8,.18)', borderRadius: 8, fontFamily: 'inherit',
        }}
      />
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(8,8,8,.6)', marginBottom: 4 }}>SEVERITY</label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['minor', 'moderate', 'major'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSeverity(s)}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 8,
              border: '1px solid rgba(8,8,8,.18)',
              background: severity === s ? '#E85D26' : '#fff',
              color: severity === s ? '#fff' : 'rgba(8,8,8,.7)',
              fontFamily: 'Oswald, sans-serif', fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'rgba(8,8,8,.6)', marginBottom: 4 }}>NOTES (optional)</label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="when did it start, what triggered it"
        style={{
          width: '100%', padding: 10, marginBottom: 12, fontSize: 13,
          border: '1px solid rgba(8,8,8,.18)', borderRadius: 8, fontFamily: 'inherit', resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={logInjury}
          disabled={busy || !site.trim()}
          style={{
            flex: 1, padding: '10px 0', borderRadius: 999,
            background: site.trim() ? '#E85D26' : 'rgba(232,128,33,.4)',
            color: '#fff', border: 'none',
            fontFamily: 'Oswald, sans-serif', fontSize: 12, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase',
            cursor: site.trim() && !busy ? 'pointer' : 'not-allowed',
          }}
        >
          {busy ? 'Saving…' : 'Log injury'}
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
