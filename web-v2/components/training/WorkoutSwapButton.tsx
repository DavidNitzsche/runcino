'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

const TYPES = [
  { v: 'easy',      l: 'Easy' },
  { v: 'long',      l: 'Long' },
  { v: 'threshold', l: 'Threshold' },
  { v: 'tempo',     l: 'Tempo' },
  { v: 'intervals', l: 'Intervals' },
  { v: 'race',      l: 'Race' },
  { v: 'rest',      l: 'Rest' },
];

export function WorkoutSwapButton({
  planId, date, currentType, currentMi, currentLabel,
}: {
  planId: string;
  date: string;
  currentType: string;
  currentMi: number;
  currentLabel: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(currentType);
  const [mi, setMi] = useState(String(currentMi));
  const [label, setLabel] = useState(currentLabel ?? '');
  const [newDate, setNewDate] = useState(date);
  const [pending, startPending] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    startPending(async () => {
      try {
        const body: any = {
          plan_id: planId,
          date_iso: date,
          type,
          distance_mi: Number(mi) || 0,
          sub_label: label || null,
        };
        if (newDate && newDate !== date) body.new_date_iso = newDate;
        const r = await fetch('/api/plan/workout', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) { setErr((await r.json()).error ?? 'Save failed'); return; }
        setOpen(false);
        router.refresh();
      } catch (e: any) { setErr(e.message ?? String(e)); }
    });
  }

  return (
    <>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        style={{
          position: 'absolute', top: 4, right: 4,
          background: 'rgba(255,255,255,0.06)', border: 'none', color: 'var(--mute)',
          width: 22, height: 22, borderRadius: 4, cursor: 'pointer', fontSize: 12,
        }}
        aria-label="Swap workout">⇄</button>
      {open && (
        <div
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
            zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}>
          <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
            style={{
              background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 18,
              padding: '24px 28px', maxWidth: 420, width: '100%',
            }}>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase', marginBottom: 12 }}>
              SWAP WORKOUT
            </div>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)', marginBottom: 16 }}>
              {date}
            </div>
            <Label>TYPE</Label>
            <select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle()}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
            <Label>DISTANCE (mi)</Label>
            <input type="number" value={mi} onChange={(e) => setMi(e.target.value)} style={inputStyle()} />
            <Label>LABEL (optional)</Label>
            <input type="text" placeholder="e.g. 'Cruise Intervals'" value={label}
              onChange={(e) => setLabel(e.target.value)} style={inputStyle()} />
            <Label>MOVE TO DATE</Label>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={inputStyle()} />
            <div style={{ fontSize: 11, color: 'var(--mute)', marginTop: 8 }}>
              Leave unchanged to just update fields. Move to a new date to reschedule.
            </div>
            {err && <div style={{ color: 'var(--over)', fontSize: 12, marginTop: 8 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={save} disabled={pending} style={{
                background: 'var(--green)', color: '#001', border: 'none', borderRadius: 8,
                padding: '8px 16px', fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1.2px',
                cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1,
              }}>{pending ? 'SAVING…' : 'SAVE'}</button>
              <button onClick={() => setOpen(false)} style={{
                background: 'transparent', color: 'var(--mute)', border: '1px solid var(--line)',
                borderRadius: 8, padding: '8px 14px',
                fontFamily: 'var(--f-display)', fontSize: 12, letterSpacing: '1.2px', cursor: 'pointer',
              }}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase', marginTop: 12, marginBottom: 4 }}>{children}</div>;
}
function inputStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink)',
    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)',
    borderRadius: 6, padding: '8px 10px', width: '100%',
  };
}
