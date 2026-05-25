'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** + ADD SHOE — inline form. */
export function AddShoeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [cap, setCap] = useState('400');
  const [pending, startPending] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    if (!brand.trim() || !model.trim()) { setErr('Brand + model required'); return; }
    startPending(async () => {
      try {
        const r = await fetch('/api/shoe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand, model, mileage_cap: Number(cap) || 400 }),
        });
        if (!r.ok) { setErr((await r.json()).error ?? 'Save failed'); return; }
        setOpen(false); setBrand(''); setModel(''); setCap('400');
        router.refresh();
      } catch (e: any) { setErr(e.message ?? String(e)); }
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        background: 'rgba(62,189,65,0.10)', color: 'var(--green)',
        border: '1px solid rgba(62,189,65,0.30)', borderRadius: 8,
        padding: '8px 14px', fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1.2px',
        cursor: 'pointer',
      }}>+ ADD SHOE</button>
    );
  }

  return (
    <div className="card" style={{ padding: '14px 18px', marginTop: 12, border: '1px solid var(--green)', background: 'rgba(62,189,65,0.04)' }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--green)', letterSpacing: '1.4px', textTransform: 'uppercase', marginBottom: 8 }}>NEW SHOE</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10 }}>
        <input placeholder="Brand (e.g. Nike)" value={brand} onChange={(e) => setBrand(e.target.value)} style={inputStyle()} />
        <input placeholder="Model (e.g. Vaporfly 3)" value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle()} />
        <input placeholder="Cap" type="number" value={cap} onChange={(e) => setCap(e.target.value)} style={{ ...inputStyle(), width: 80 }} />
      </div>
      {err && <div style={{ color: 'var(--over)', fontSize: 11, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button onClick={save} disabled={pending} style={primaryBtn(pending)}>{pending ? '…' : 'SAVE'}</button>
        <button onClick={() => { setOpen(false); setErr(null); }} style={secondaryBtn()}>CANCEL</button>
      </div>
    </div>
  );
}

/** Click a shoe to edit/retire. Edit form for mileage + cap; Retire toggle. */
export function ShoeEditCard({
  shoe,
}: {
  shoe: { id: string; name: string; brand: string; model: string; mileage: number; cap: number; pctUsed: number; retired?: boolean };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mileage, setMileage] = useState(String(shoe.mileage));
  const [cap, setCap] = useState(String(shoe.cap));
  const [pending, startPending] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save(patch: Record<string, any>) {
    setErr(null);
    startPending(async () => {
      try {
        const r = await fetch('/api/shoe', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(shoe.id), ...patch }),
        });
        if (!r.ok) { setErr((await r.json()).error ?? 'Save failed'); return; }
        setOpen(false);
        router.refresh();
      } catch (e: any) { setErr(e.message ?? String(e)); }
    });
  }

  if (!open) {
    const barColor = shoe.pctUsed >= 80 ? 'var(--over)' : shoe.pctUsed >= 60 ? 'var(--goal)' : 'var(--green)';
    return (
      <button onClick={() => setOpen(true)} className="card" style={{
        padding: '14px', textAlign: 'left', cursor: 'pointer', display: 'block', width: '100%',
      }}>
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 16, color: 'var(--ink)', lineHeight: 1.1 }}>{shoe.name}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10 }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: 24, color: barColor }}>{shoe.mileage}</span>
          <span style={{ fontSize: 10, color: 'var(--mute)' }}>/ {shoe.cap} mi</span>
        </div>
        <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, shoe.pctUsed)}%`, background: barColor }} />
        </div>
      </button>
    );
  }

  return (
    <div className="card" style={{ padding: '14px', border: '1px solid var(--green)', background: 'rgba(62,189,65,0.04)' }}>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: 14, color: 'var(--ink)', marginBottom: 8 }}>{shoe.name}</div>
      <label style={{ display: 'block', fontSize: 9, color: 'var(--mute)', letterSpacing: '1.2px', marginBottom: 4 }}>MILEAGE</label>
      <input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)} style={{ ...inputStyle(), width: '100%' }} />
      <label style={{ display: 'block', fontSize: 9, color: 'var(--mute)', letterSpacing: '1.2px', marginTop: 8, marginBottom: 4 }}>CAP</label>
      <input type="number" value={cap} onChange={(e) => setCap(e.target.value)} style={{ ...inputStyle(), width: '100%' }} />
      {err && <div style={{ color: 'var(--over)', fontSize: 10, marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 4, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={() => save({ mileage: Number(mileage), mileage_cap: Number(cap) })} disabled={pending}
          style={primaryBtn(pending)}>SAVE</button>
        <button onClick={() => save({ retired: true })} disabled={pending} style={{
          background: 'transparent', color: 'var(--over)', border: '1px solid var(--over)',
          borderRadius: 6, padding: '6px 10px', fontFamily: 'var(--f-display)', fontSize: 10,
          letterSpacing: '1px', cursor: 'pointer',
        }}>RETIRE</button>
        <button onClick={() => { setOpen(false); setErr(null); }} style={secondaryBtn()}>×</button>
      </div>
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink)',
    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)',
    borderRadius: 6, padding: '6px 8px',
  };
}
function primaryBtn(pending: boolean): React.CSSProperties {
  return {
    background: 'var(--green)', color: '#001', border: 'none', borderRadius: 6,
    padding: '6px 12px', fontFamily: 'var(--f-display)', fontSize: 11,
    letterSpacing: '1px', cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1,
  };
}
function secondaryBtn(): React.CSSProperties {
  return {
    background: 'transparent', color: 'var(--mute)', border: '1px solid var(--line)',
    borderRadius: 6, padding: '6px 10px', fontFamily: 'var(--f-display)', fontSize: 11,
    letterSpacing: '1px', cursor: 'pointer',
  };
}
