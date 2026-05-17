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
      if (res.ok) setLogged(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="coach-right">
      <div className="checkin-label">Today&apos;s Check-In{logged ? ' · logged ✓' : ''}</div>
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
