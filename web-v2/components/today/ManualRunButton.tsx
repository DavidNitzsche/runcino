'use client';

/**
 * ManualRunButton — quick "log a run" entry on /today for when the watch
 * + sync didn't capture it (treadmill, indoor, forgotten watch). Compact
 * inline form on tap.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ManualRunButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => new Date(Date.now() - 7 * 3600000).toISOString().slice(0, 10));
  const [mi, setMi] = useState('');
  const [min, setMin] = useState('');
  const [avgHr, setAvgHr] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false); setMi(''); setMin(''); setAvgHr(''); setNotes(''); setError(null);
  }

  async function submit() {
    setError(null);
    const distance_mi = parseFloat(mi);
    if (!isFinite(distance_mi) || distance_mi <= 0) { setError('enter distance'); return; }
    const duration_min = min ? parseFloat(min) : null;
    const avg_hr_bpm = avgHr ? parseInt(avgHr, 10) : null;
    try {
      const r = await fetch('/api/run/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, distance_mi, duration_min, avg_hr_bpm, notes }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'failed');
      startTransition(() => router.refresh());
      reset();
    } catch (e: any) {
      setError(e.message ?? String(e));
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1.2px',
          color: 'var(--mute)', background: 'transparent',
          border: '1px dashed var(--line)', borderRadius: 999,
          padding: '6px 14px', cursor: 'pointer',
        }}
      >
        + LOG RUN MANUALLY
      </button>
    );
  }

  return (
    <div className="card" style={{ padding: '16px 18px', background: 'rgba(62,189,65,0.04)', borderColor: 'rgba(62,189,65,0.30)' }}>
      <div className="card-eyebrow" style={{ color: 'var(--green)' }}>LOG RUN</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 8 }}>
        <LabeledInput label="Date" value={date} onChange={setDate} type="date" />
        <LabeledInput label="Miles" value={mi} onChange={setMi} type="number" placeholder="6.2" />
        <LabeledInput label="Minutes" value={min} onChange={setMin} type="number" placeholder="55" />
        <LabeledInput label="Avg HR" value={avgHr} onChange={setAvgHr} type="number" placeholder="135" />
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional) — felt easy, hot, slept poorly, etc."
        style={{
          width: '100%', marginTop: 10, padding: 10,
          background: 'var(--card-2)', border: '1px solid var(--line)', borderRadius: 8,
          color: 'var(--ink)', fontFamily: 'var(--f-body)', fontSize: 13, resize: 'vertical', minHeight: 60,
        }}
      />
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button onClick={submit} disabled={pending || !mi}
          style={{
            background: 'var(--green)', color: '#001', border: 'none', borderRadius: 8,
            padding: '8px 16px', fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1.2px',
            cursor: pending || !mi ? 'default' : 'pointer', opacity: !mi ? 0.5 : 1,
          }}>
          {pending ? 'SAVING…' : 'SAVE RUN'}
        </button>
        <button onClick={reset}
          style={{
            background: 'transparent', color: 'var(--mute)', border: '1px solid var(--line)',
            borderRadius: 8, padding: '8px 14px', fontFamily: 'var(--f-label)', fontSize: 11,
            letterSpacing: '1.2px', cursor: 'pointer',
          }}>
          CANCEL
        </button>
      </div>
      {error && <div style={{ color: 'var(--over)', fontSize: 11, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

function LabeledInput({ label, value, onChange, type = 'text', placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontFamily: 'var(--f-body)', fontSize: 9, color: 'var(--mute)', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 4 }}>{label}</span>
      <input
        value={value} type={type} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'var(--card-2)', border: '1px solid var(--line)', borderRadius: 6,
          color: 'var(--ink)', fontFamily: 'var(--f-label)', fontSize: 14, padding: '6px 10px',
        }}
      />
    </label>
  );
}
