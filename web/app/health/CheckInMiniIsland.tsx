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
      if (res.ok) setLogged(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="health-checkin-mini">
      <div className="health-checkin-mini-label">Today&apos;s Check-In{logged ? ' · logged ✓' : ''}</div>
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
