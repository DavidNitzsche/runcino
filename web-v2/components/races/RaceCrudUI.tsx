'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** + ADD RACE — button + inline form. Posts to /api/race. */
export function AddRaceButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [distance, setDistance] = useState('Half Marathon');
  const [priority, setPriority] = useState<'A' | 'B' | 'C'>('B');
  const [goal, setGoal] = useState('');
  const [saving, startSaving] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    if (!name.trim() || !date) { setErr('Name + date required'); return; }
    startSaving(async () => {
      try {
        const r = await fetch('/api/race', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, date, distance_label: distance, priority, goal: goal || null }),
        });
        if (!r.ok) { setErr((await r.json()).error ?? 'Save failed'); return; }
        setOpen(false);
        setName(''); setDate(''); setGoal('');
        router.refresh();
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        background: 'var(--green)', color: '#001', border: 'none',
        padding: '10px 18px', borderRadius: 8,
        fontFamily: 'var(--f-display)', fontSize: 13, letterSpacing: '1.2px',
        cursor: 'pointer',
      }}>+ ADD RACE</button>
    );
  }

  return (
    <div className="card" style={{ padding: '20px 24px', marginBottom: 18, border: '1px solid var(--green)', background: 'rgba(62,189,65,0.04)' }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--green)', letterSpacing: '1.6px', textTransform: 'uppercase', marginBottom: 12 }}>
        NEW RACE
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 10 }}>
        <input placeholder="Race name" value={name} onChange={(e) => setName(e.target.value)}
               style={inputStyle()} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
               style={inputStyle()} />
        <select value={distance} onChange={(e) => setDistance(e.target.value)} style={inputStyle()}>
          <option>5K</option><option>10K</option><option>Half Marathon</option><option>Marathon</option><option>50K</option>
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as any)} style={inputStyle()}>
          <option value="A">A · Goal</option><option value="B">B · Tune-up</option><option value="C">C · For fun</option>
        </select>
        <input placeholder="Goal (e.g. 1:30)" value={goal} onChange={(e) => setGoal(e.target.value)}
               style={inputStyle()} />
      </div>
      {err && <div style={{ color: 'var(--over)', fontSize: 12, marginTop: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={save} disabled={saving} style={primaryBtn(saving)}>{saving ? 'SAVING…' : 'SAVE'}</button>
        <button onClick={() => { setOpen(false); setErr(null); }} style={secondaryBtn()}>CANCEL</button>
      </div>
    </div>
  );
}

/** Inline edit form for a race. Updates via PATCH /api/race. */
export function EditRaceButton({ slug, current }: {
  slug: string;
  current: { name: string; date: string; distance_label?: string | null; priority?: string | null; goal?: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(current.name);
  const [date, setDate] = useState(current.date);
  const [distance, setDistance] = useState(current.distance_label ?? 'Half Marathon');
  const [priority, setPriority] = useState<'A' | 'B' | 'C'>((current.priority ?? 'B') as any);
  const [goal, setGoal] = useState(current.goal ?? '');
  const [saving, startSaving] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    if (!name.trim() || !date) { setErr('Name + date required'); return; }
    startSaving(async () => {
      try {
        const r = await fetch('/api/race', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, name, date, distance_label: distance, priority, goal: goal || null }),
        });
        if (!r.ok) { setErr((await r.json()).error ?? 'Save failed'); return; }
        setOpen(false);
        router.refresh();
      } catch (e: any) {
        setErr(e.message ?? String(e));
      }
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        background: 'transparent', border: '1px solid var(--line)', color: 'var(--mute)',
        padding: '8px 14px', borderRadius: 8,
        fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1px', cursor: 'pointer',
      }}>EDIT RACE</button>
    );
  }

  return (
    <div className="card" style={{ padding: '20px 24px', marginTop: 18, border: '1px solid var(--green)', background: 'rgba(62,189,65,0.04)' }}>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, color: 'var(--green)', letterSpacing: '1.6px', textTransform: 'uppercase', marginBottom: 12 }}>
        EDIT RACE
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 10 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle()} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle()} />
        <select value={distance} onChange={(e) => setDistance(e.target.value)} style={inputStyle()}>
          <option>5K</option><option>10K</option><option>Half Marathon</option><option>Marathon</option><option>50K</option>
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value as any)} style={inputStyle()}>
          <option value="A">A · Goal</option><option value="B">B · Tune-up</option><option value="C">C · For fun</option>
        </select>
        <input placeholder="Goal" value={goal} onChange={(e) => setGoal(e.target.value)} style={inputStyle()} />
      </div>
      {err && <div style={{ color: 'var(--over)', fontSize: 12, marginTop: 10 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={save} disabled={saving} style={primaryBtn(saving)}>{saving ? 'SAVING…' : 'SAVE'}</button>
        <button onClick={() => { setOpen(false); setErr(null); }} style={secondaryBtn()}>CANCEL</button>
      </div>
    </div>
  );
}

/** Delete a race. Confirmation built into UI; no confirm() popup. */
export function DeleteRaceButton({ slug }: { slug: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startPending] = useTransition();

  function del() {
    startPending(async () => {
      const r = await fetch('/api/race', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      if (r.ok) router.push('/races');
    });
  }

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} style={{
        background: 'transparent', color: 'var(--mute)', border: '1px solid var(--line)',
        padding: '8px 14px', borderRadius: 8,
        fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1px', cursor: 'pointer',
      }}>DELETE RACE</button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ color: 'var(--over)', fontSize: 12 }}>Sure?</span>
      <button onClick={del} disabled={pending} style={{
        background: 'var(--over)', color: '#fff', border: 'none',
        padding: '8px 14px', borderRadius: 8,
        fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1px', cursor: 'pointer',
      }}>{pending ? 'DELETING…' : 'YES, DELETE'}</button>
      <button onClick={() => setConfirming(false)} style={secondaryBtn()}>CANCEL</button>
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink)',
    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)',
    borderRadius: 8, padding: '8px 10px',
  };
}
function primaryBtn(saving: boolean): React.CSSProperties {
  return {
    background: 'var(--green)', color: '#001', border: 'none',
    padding: '8px 16px', borderRadius: 8,
    fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1.2px',
    cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1,
  };
}
function secondaryBtn(): React.CSSProperties {
  return {
    background: 'transparent', color: 'var(--mute)', border: '1px solid var(--line)',
    padding: '8px 14px', borderRadius: 8,
    fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1.2px', cursor: 'pointer',
  };
}
