'use client';

/**
 * /health · compact Today's Check-In widget (smaller variant of the
 * overview check-in). Same /api/checkin POST endpoint.
 */

import { useEffect, useState } from 'react';

export function CheckInMiniIsland({ today }: { today: string }) {
  const [energy, setEnergy] = useState(7);
  const [soreness, setSoreness] = useState(3);
  const [stress, setStress] = useState(2);
  const [busy, setBusy] = useState(false);
  const [logged, setLogged] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetch(`/api/checkin?date=${today}`).then((r) => r.json()).then((j) => {
      if (j?.checkin) {
        setEnergy(j.checkin.energy);
        setSoreness(j.checkin.soreness);
        setStress(j.checkin.stress);
        setLogged(true);
      }
    }).catch(() => {});
  }, [today]);

  async function log() {
    setBusy(true);
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today, energy, soreness, stress }),
      });
      if (res.ok) { setLogged(true); setEditing(false); }
    } finally {
      setBusy(false);
    }
  }

  // Confirmed state, solid green card with a checkmark + logged stats.
  if (logged && !editing) {
    const stat = (label: string, val: number) => (
      <div style={{ textAlign: 'center', flex: 1 }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 18, color: '#fff', lineHeight: 1 }}>{val}</div>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 8.5, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,.82)', marginTop: 4 }}>{label}</div>
      </div>
    );
    return (
      <div className="health-checkin-mini" style={{ background: 'var(--recovery, #3EBD41)', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: 999, background: 'rgba(255,255,255,.22)', color: '#fff', fontSize: 11, fontWeight: 700 }}>✓</span>
          <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' }}>Checked in for today</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {stat('Energy', energy)}
          {stat('Soreness', soreness)}
          {stat('Stress', stress)}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          style={{ width: '100%', background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.28)', borderRadius: 999, padding: '8px 0', cursor: 'pointer', fontFamily: 'Oswald, sans-serif', fontSize: 10, letterSpacing: 1.1, textTransform: 'uppercase', fontWeight: 700, color: '#fff' }}
        >
          Edit
        </button>
      </div>
    );
  }

  return (
    <div className="health-checkin-mini">
      <div className="health-checkin-mini-label">Today&apos;s Check-In</div>
      <div className="health-checkin-mini-sliders">
        <Row label="Energy"   value={energy}   set={setEnergy}   cls="energy" />
        <Row label="Soreness" value={soreness} set={setSoreness} cls="soreness" />
        <Row label="Stress"   value={stress}   set={setStress}   cls="stress" />
      </div>
      <button className="health-checkin-mini-btn" type="button" disabled={busy} onClick={log}>
        {busy ? 'Saving…' : logged ? 'Update' : 'Log Check-In'}
      </button>
    </div>
  );
}

function Row({ label, value, set, cls }: { label: string; value: number; set: (n: number) => void; cls: string }) {
  return (
    <div className="health-checkin-row">
      <span className="health-checkin-row-label">{label}</span>
      <input type="range" className={`checkin-range ${cls}`} min={1} max={10} value={value} onChange={(e) => set(parseInt(e.target.value, 10))} />
      <span className="health-checkin-row-val">{value}</span>
    </div>
  );
}
