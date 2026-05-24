'use client';

/**
 * Fueling section on /profile.
 *
 * The runner sets their gel product here once. Everything downstream
 * (training-fueling planner, watch prompts by product name, the workout
 * detail's gel timeline) reads from these three numbers, so changing
 * brand once updates every prescription instantly. No more inheriting
 * the legacy 22g default when the runner actually carries Maurten 100s.
 *
 * Fields:
 *   brand        — display name ("Maurten 100", "SiS Beta Fuel", "GU Roctane")
 *   gelCarbsG    — carbs in ONE packet (typical 22-44g, DB CHECK 10-80)
 *   targetGPerHr — race-day carbohydrate intake target (60-90 typical)
 *
 * Saves via POST /api/me/fuel which patches partial updates.
 */

import { useState } from 'react';

export interface FuelInitial {
  brand: string | null;
  gelCarbsG: number | null;
  targetGPerHr: number | null;
}

export function FuelIsland({ initial }: { initial?: FuelInitial }) {
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [carbs, setCarbs] = useState(initial?.gelCarbsG?.toString() ?? '');
  const [target, setTarget] = useState(initial?.targetGPerHr?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = {};
      body.brand = brand.trim() === '' ? null : brand.trim();
      const cN = carbs.trim() === '' ? null : Number(carbs);
      const tN = target.trim() === '' ? null : Number(target);
      body.gelCarbsG = cN;
      body.targetGPerHr = tN;
      const res = await fetch('/api/me/fuel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j?.error || 'Save failed'); return; }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  const labelStyle = {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.8,
    color: 'rgba(8,8,8,.55)',
    marginBottom: 4,
    textTransform: 'uppercase' as const,
  };
  const inputStyle = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid rgba(8,8,8,.18)',
    borderRadius: 6,
    fontFamily: 'Inter, sans-serif',
    fontSize: 14,
    color: '#080808',
    background: 'white',
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div className="card-title-group">
          <div className="card-title">Fueling</div>
          <div className="card-sub">
            Your gel product. The whole app reads this — workouts, watch
            prompts, race-day plans all use your real carbs-per-packet
            and hourly target.
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, padding: '10px 0' }}>
        <div>
          <div style={labelStyle}>Brand</div>
          <input
            type="text"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="e.g. Maurten 100"
            style={inputStyle}
          />
        </div>
        <div>
          <div style={labelStyle}>Carbs / gel</div>
          <input
            type="number"
            inputMode="numeric"
            value={carbs}
            onChange={(e) => setCarbs(e.target.value)}
            placeholder="25"
            min={10}
            max={80}
            style={inputStyle}
          />
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10.5, color: 'rgba(8,8,8,.45)', marginTop: 3 }}>grams</div>
        </div>
        <div>
          <div style={labelStyle}>Target / hr</div>
          <input
            type="number"
            inputMode="numeric"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="60"
            min={30}
            max={120}
            style={inputStyle}
          />
          <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10.5, color: 'rgba(8,8,8,.45)', marginTop: 3 }}>g/hour</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 6 }}>
        <button
          onClick={save}
          disabled={busy}
          style={{
            padding: '8px 14px',
            border: 'none',
            borderRadius: 6,
            background: '#080808',
            color: 'white',
            fontFamily: 'Inter, sans-serif',
            fontSize: 13,
            fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.5 : 1,
          }}
        >{busy ? 'Saving…' : 'Save'}</button>
        {saved && (
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#36A853' }}>
            Saved. The app reads this now.
          </span>
        )}
        {err && (
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12, color: '#FC4D64' }}>
            {err}
          </span>
        )}
      </div>
    </div>
  );
}
