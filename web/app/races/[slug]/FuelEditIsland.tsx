'use client';

/**
 * FuelEditIsland — inline-editable Brand / Gels / Carbs / Rate row.
 *
 * The Fueling Plan card renders 4 stat tiles. With this island the
 * user can click the row to edit gel brand, gel size (g of carbs),
 * and the target carb rate (g/hr). On save we POST to
 * /api/races/[slug]/rebuild with those fields; the rebuild calls
 * the fueling planner again so the gel count, total carbs, anchor
 * miles and per-mile markers all recompute. router.refresh() then
 * pulls the new plan onto the page.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  slug: string;
  gelBrand: string;
  gelCount: number;
  gelCarbsG: number;
  totalCarbsG: number;
  carbRateGPerHr: number;
  carbTargetGPerHr: number;
  goalDisplay: string;
}

export function FuelEditIsland({
  slug,
  gelBrand,
  gelCount,
  gelCarbsG,
  totalCarbsG,
  carbRateGPerHr,
  carbTargetGPerHr,
  goalDisplay,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [brand, setBrand] = useState(gelBrand);
  const [carbs, setCarbs] = useState(String(gelCarbsG));
  const [rate, setRate] = useState(String(carbTargetGPerHr));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const gelCarbsParsed = parseInt(carbs, 10);
    const rateParsed = parseInt(rate, 10);
    if (Number.isNaN(gelCarbsParsed) || gelCarbsParsed < 10 || gelCarbsParsed > 100) {
      setErr('Gel carbs must be between 10–100 g'); return;
    }
    if (Number.isNaN(rateParsed) || rateParsed < 30 || rateParsed > 120) {
      setErr('Target rate must be between 30–120 g/hr'); return;
    }
    if (!brand.trim()) { setErr('Brand required'); return; }

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/races/${slug}/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gelBrand: brand.trim(),
          gelCarbsG: gelCarbsParsed,
          carbTargetGPerHr: rateParsed,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j?.error || `Rebuild failed (${res.status})`);
        setBusy(false);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setErr('Network error');
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="fuel-summary fuel-summary-editing">
        <form
          onSubmit={(e) => { e.preventDefault(); save(); }}
          style={{ display: 'contents' }}
        >
          <div className="fuel-cell">
            <div className="fuel-cell-label">Brand</div>
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="fuel-input"
              placeholder="Maurten"
              autoFocus
              disabled={busy}
            />
            <div className="fuel-cell-sub">e.g. Maurten, GU, SiS</div>
          </div>
          <div className="fuel-cell">
            <div className="fuel-cell-label">Carbs / Gel</div>
            <input
              type="number"
              value={carbs}
              onChange={(e) => setCarbs(e.target.value)}
              className="fuel-input"
              placeholder="40"
              min={10}
              max={100}
              disabled={busy}
            />
            <div className="fuel-cell-sub">g per gel</div>
          </div>
          <div className="fuel-cell">
            <div className="fuel-cell-label">Target Rate</div>
            <input
              type="number"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="fuel-input"
              placeholder="60"
              min={30}
              max={120}
              disabled={busy}
            />
            <div className="fuel-cell-sub">g/hr · drives gel count</div>
          </div>
          <div className="fuel-cell" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div className="fuel-cell-label">Save Changes</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button type="submit" className="fuel-save-btn" disabled={busy}>
                {busy ? 'Rebuilding…' : 'Save'}
              </button>
              <button
                type="button"
                className="fuel-cancel-btn"
                onClick={() => {
                  setEditing(false);
                  setErr(null);
                  setBrand(gelBrand);
                  setCarbs(String(gelCarbsG));
                  setRate(String(carbTargetGPerHr));
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
            {err && <div className="fuel-err">{err}</div>}
          </div>
        </form>
        <style jsx>{`
          .fuel-summary-editing { width: 100%; }
          .fuel-input {
            font-family: 'Bebas Neue', sans-serif;
            font-size: 28px; line-height: 1;
            width: 100%;
            padding: 4px 0;
            border: none;
            border-bottom: 2px solid #E85D26;
            background: transparent;
            color: #0D0F12;
            margin-top: 6px;
            letter-spacing: 0;
          }
          .fuel-input:focus { outline: none; }
          .fuel-save-btn, .fuel-cancel-btn {
            font-family: 'Oswald', sans-serif; font-weight: 600;
            font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
            padding: 7px 12px; border-radius: 6px; cursor: pointer;
            border: 1px solid;
          }
          .fuel-save-btn { background: #0D0F12; color: #fff; border-color: #0D0F12; }
          .fuel-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
          .fuel-cancel-btn { background: transparent; color: rgba(13,15,18,.55); border-color: rgba(13,15,18,.16); }
          .fuel-err {
            font-family: 'Inter', sans-serif; font-size: 11px; color: #B00020;
            margin-top: 6px; grid-column: 1 / -1;
          }
        `}</style>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="fuel-summary fuel-summary-btn"
      onClick={() => setEditing(true)}
      title="Click to edit your fueling — brand, gel size, target rate"
    >
      <div className="fuel-cell">
        <div className="fuel-cell-label">Brand</div>
        <div className="fuel-cell-value">{gelBrand || '—'}</div>
        <div className="fuel-cell-sub">Gel · tap to edit</div>
      </div>
      <div className="fuel-cell">
        <div className="fuel-cell-label">Gels</div>
        <div className="fuel-cell-value">{gelCount}</div>
        <div className="fuel-cell-sub">{gelCarbsG} g each</div>
      </div>
      <div className="fuel-cell">
        <div className="fuel-cell-label">Total Carbs</div>
        <div className="fuel-cell-value">{totalCarbsG} g</div>
        <div className="fuel-cell-sub">across {goalDisplay}</div>
      </div>
      <div className="fuel-cell">
        <div className="fuel-cell-label">Rate</div>
        <div className="fuel-cell-value">
          {carbRateGPerHr.toFixed(1)}
          <span style={{ fontSize: 18, color: 'rgba(13,15,18,.35)' }}>g/hr</span>
        </div>
        <div className="fuel-cell-sub">target {carbTargetGPerHr} g/hr</div>
      </div>
      <style jsx>{`
        button.fuel-summary-btn {
          all: unset;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          padding: 0 40px 22px;
          cursor: pointer;
          width: 100%;
          box-sizing: border-box;
        }
        button.fuel-summary-btn:hover :global(.fuel-cell) {
          background: rgba(232,93,38,.06);
          border-color: rgba(232,93,38,.30);
        }
        button.fuel-summary-btn :global(.fuel-cell) {
          transition: background 120ms ease, border-color 120ms ease;
        }
      `}</style>
    </button>
  );
}
