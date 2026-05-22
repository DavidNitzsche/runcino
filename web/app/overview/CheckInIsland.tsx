'use client';

/**
 * /overview · Today's Check-In sliders.
 *
 * Three 1-10 sliders (Energy / Soreness / Stress) + a "Log Check-In"
 * button that POSTs to /api/checkin. Server component parent renders
 * the rest of the page.
 */

import { useEffect, useState } from 'react';

export function CheckInIsland({ today }: { today: string }) {
  const [energy, setEnergy] = useState(6);
  const [soreness, setSoreness] = useState(4);
  const [stress, setStress] = useState(2);
  const [busy, setBusy] = useState(false);
  const [logged, setLogged] = useState(false);
  const [editing, setEditing] = useState(false);

  // Load existing check-in for today (if any)
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

  // Confirmed state — solid green card with a checkmark + the logged stats.
  if (logged && !editing) {
    const stat = (label: string, val: number) => (
      <div style={{ textAlign: 'center', flex: 1 }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 22, color: '#fff', lineHeight: 1 }}>{val}</div>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 9.5, letterSpacing: 1.2, textTransform: 'uppercase', color: 'rgba(255,255,255,.82)', marginTop: 5 }}>{label}</div>
      </div>
    );
    return (
      <div className="coach-right">
        <div
          style={{
            background: 'var(--recovery, #2CA82F)',
            borderRadius: 12,
            padding: '18px 20px',
            color: '#fff',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span
              aria-hidden
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 22, height: 22, borderRadius: 999,
                background: 'rgba(255,255,255,.22)', color: '#fff', fontSize: 13, fontWeight: 700,
              }}
            >✓</span>
            <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: 0.4, textTransform: 'uppercase' }}>
              Checked in for today
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            {stat('Energy', energy)}
            {stat('Soreness', soreness)}
            {stat('Stress', stress)}
          </div>
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{
              marginTop: 16, width: '100%',
              background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.28)',
              borderRadius: 999, padding: '8px 0', cursor: 'pointer',
              fontFamily: 'Oswald, sans-serif', fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: 700, color: '#fff',
            }}
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="coach-right">
      <div className="checkin-label">Today&apos;s Check-In</div>
      <div className="checkin-sliders">
        <div className="checkin-slider-row">
          <span className="checkin-slider-label">Energy</span>
          <input type="range" className="checkin-range energy" min={1} max={10} value={energy} onChange={(e) => setEnergy(parseInt(e.target.value, 10))} />
          <span className="checkin-slider-val">{energy}</span>
        </div>
        <div className="checkin-slider-row">
          <span className="checkin-slider-label">Soreness</span>
          <input type="range" className="checkin-range soreness" min={1} max={10} value={soreness} onChange={(e) => setSoreness(parseInt(e.target.value, 10))} />
          <span className="checkin-slider-val">{soreness}</span>
        </div>
        <div className="checkin-slider-row">
          <span className="checkin-slider-label">Stress</span>
          <input type="range" className="checkin-range stress" min={1} max={10} value={stress} onChange={(e) => setStress(parseInt(e.target.value, 10))} />
          <span className="checkin-slider-val">{stress}</span>
        </div>
      </div>
      <button className="checkin-btn" type="button" disabled={busy} onClick={log}>
        {busy ? 'Saving…' : logged ? 'Update' : 'Log Check-In'}
      </button>
    </div>
  );
}
