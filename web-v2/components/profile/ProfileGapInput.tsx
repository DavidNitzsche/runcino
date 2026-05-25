'use client';

import { useState, useTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * §8.6 closed loop: gap card → input → PATCH /api/profile → coach reads next briefing.
 * Inline expansion (not a modal sheet — fits the desktop layout). On mobile the
 * card itself stays compact; the input expands below on tap.
 */
export function ProfileGapInput({ field, label, why, focused }: { field: string; label: string; why: string; focused?: boolean }) {
  const [open, setOpen] = useState(!!focused);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<'cm' | 'in'>('cm');
  const [ack, setAck] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (focused) setOpen(true);
  }, [focused]);

  function submit() {
    if (pending) return;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) { setAck('(enter a number)'); return; }
    // Convert to cm if entered in inches.
    const cm = unit === 'in' ? Math.round(n * 2.54) : Math.round(n);
    if (cm < 120 || cm > 220) { setAck('(out of range — 120-220 cm)'); return; }

    startTransition(async () => {
      try {
        const res = await fetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: cm }),
        });
        if (res.ok) {
          setAck('Saved. Coach will mention it on next briefing.');
          router.refresh();  // closed loop — next /today render reads new value
        } else {
          setAck("(couldn't save — try again)");
        }
      } catch {
        setAck('(network hiccup — try again)');
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="card"
        style={{
          padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
          textAlign: 'left', cursor: 'pointer',
          border: '1px solid rgba(252,77,100,0.25)', background: 'rgba(252,77,100,0.04)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--over)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 4 }}>
            MISSING
          </div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 20 }}>{label}</div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 2 }}>{why}</div>
        </div>
        <span style={{
          background: 'rgba(252,77,100,0.12)', color: 'var(--over)',
          border: '1px solid rgba(252,77,100,0.25)', borderRadius: 999,
          padding: '7px 14px', fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1px',
        }}>+ ADD</span>
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
        ADD {label.toUpperCase()}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <input
          autoFocus
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          style={{
            fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)',
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)',
            borderRadius: 8, padding: '8px 12px', width: 100, letterSpacing: '0.5px',
          }}
        />
        <div style={{ display: 'flex', gap: 4 }}>
          {(['cm', 'in'] as const).map((u) => (
            <button key={u} onClick={() => setUnit(u)}
              style={{
                background: unit === u ? 'rgba(62,189,65,0.12)' : 'transparent',
                border: `1px solid ${unit === u ? 'var(--green)' : 'var(--line)'}`,
                color: unit === u ? 'var(--green)' : 'var(--mute)',
                borderRadius: 6, padding: '4px 10px',
                fontFamily: 'var(--f-display)', fontSize: 10, letterSpacing: '1px',
                cursor: 'pointer',
              }}>{u.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          onClick={submit}
          disabled={pending || !value}
          style={{
            background: 'var(--green)', color: '#001', border: 'none', borderRadius: 8,
            padding: '8px 16px', fontFamily: 'var(--f-display)', fontSize: 11, letterSpacing: '1.2px',
            cursor: pending || !value ? 'default' : 'pointer', opacity: !value ? 0.5 : 1,
          }}>
          {pending ? 'SAVING…' : 'SAVE'}
        </button>
        <button onClick={() => { setOpen(false); setValue(''); setAck(null); }}
          style={{
            background: 'transparent', color: 'var(--mute)', border: '1px solid var(--line)',
            borderRadius: 8, padding: '8px 14px', fontFamily: 'var(--f-display)', fontSize: 11,
            letterSpacing: '1.2px', cursor: 'pointer',
          }}>
          CANCEL
        </button>
      </div>
      {ack && (
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--green)', marginTop: 8, fontStyle: 'italic' }}>
          {ack}
        </div>
      )}
    </div>
  );
}
