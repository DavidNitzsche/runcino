'use client';

/**
 * FuelEditIsland — type your gel, the coach fills in the rest.
 *
 * The user only tells us WHICH gel they're using. Total carbs and
 * carb rate are coach-decided (carbs from the gel's spec, rate from
 * race duration + effort). Only the Brand tile is editable; the
 * other 3 stat tiles show the coach's outputs.
 *
 * Save POSTs to /api/races/[slug]/rebuild with just gelBrand. The
 * backend looks up the gel's carb content via Claude (when the API
 * key is present) and recomputes the plan with the gel's actual
 * carb-per-serving plus a race-tuned rate.
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!brand.trim()) { setErr('Type the gel you\'re using'); return; }

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/races/${slug}/rebuild`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gelBrand: brand.trim(),
          // Don't pass carbs or rate — let the coach decide based on
          // the gel's spec and the race effort. Sending nullish/omit
          // for these clears any prior override.
          gelCarbsG: null,
          carbTargetGPerHr: null,
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

  return (
    <div className="fuel-summary">
      {editing ? (
        <div className="fuel-cell" style={{ gridColumn: 'span 4' }}>
          <div className="fuel-cell-label">What gel are you using?</div>
          <form
            onSubmit={(e) => { e.preventDefault(); save(); }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}
          >
            <input
              type="text"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="fuel-input"
              placeholder="e.g. Maurten Gel 100, GU Roctane, SiS Beta Fuel"
              autoFocus
              disabled={busy}
              style={{ flex: 1 }}
            />
            <button type="submit" className="fuel-save-btn" disabled={busy}>
              {busy ? 'Coach thinking…' : 'Save'}
            </button>
            <button
              type="button"
              className="fuel-cancel-btn"
              onClick={() => { setEditing(false); setErr(null); setBrand(gelBrand); }}
              disabled={busy}
            >
              Cancel
            </button>
          </form>
          <div className="fuel-cell-sub" style={{ marginTop: 10 }}>
            The coach figures out carbs per gel + the right intake rate
            for {goalDisplay} effort. You don&rsquo;t do that math.
          </div>
          {err && <div className="fuel-err">{err}</div>}
          <style jsx>{`
            .fuel-input {
              font-family: 'Bebas Neue', sans-serif;
              font-size: 28px; line-height: 1;
              padding: 4px 0;
              border: none;
              border-bottom: 2px solid #E85D26;
              background: transparent;
              color: #080808;
              letter-spacing: 0;
            }
            .fuel-input:focus { outline: none; }
            .fuel-save-btn, .fuel-cancel-btn {
              font-family: 'Oswald', sans-serif; font-weight: 600;
              font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase;
              padding: 8px 14px; border-radius: 6px; cursor: pointer;
              border: 1px solid;
              flex-shrink: 0;
            }
            .fuel-save-btn { background: #080808; color: #fff; border-color: #080808; }
            .fuel-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .fuel-cancel-btn { background: transparent; color: rgba(8,8,8,.55); border-color: rgba(8,8,8,.16); }
            .fuel-err {
              font-family: 'Inter', sans-serif; font-size: 11px; color: #B00020;
              margin-top: 6px;
            }
          `}</style>
        </div>
      ) : (
        <>
          {/* Only Brand is user-editable. The other tiles are coach outputs. */}
          <button
            type="button"
            className="fuel-cell fuel-cell-btn"
            onClick={() => setEditing(true)}
            title="Click to change which gel you're using"
          >
            <div className="fuel-cell-label">Brand</div>
            <div className="fuel-cell-value">{gelBrand || 'Set yours'}</div>
            <div className="fuel-cell-sub">
              <em style={{ color: '#E85D26', fontStyle: 'normal', fontWeight: 600 }}>tap to edit</em>
            </div>
            <style jsx>{`
              button.fuel-cell-btn {
                all: unset;
                box-sizing: border-box;
                cursor: pointer;
                background: rgba(8,8,8,.04);
                border: 1px solid rgba(8,8,8,.08);
                border-radius: 10px;
                padding: 16px 20px;
                display: block;
                transition: background 120ms ease, border-color 120ms ease;
              }
              button.fuel-cell-btn:hover {
                background: rgba(232,128,33,.06);
                border-color: rgba(232,128,33,.30);
              }
            `}</style>
          </button>

          <div className="fuel-cell">
            <div className="fuel-cell-label">Gels</div>
            <div className="fuel-cell-value">{gelCount}</div>
            <div className="fuel-cell-sub">{gelCarbsG} g each · coach-set</div>
          </div>
          <div className="fuel-cell">
            <div className="fuel-cell-label">Total Carbs</div>
            <div className="fuel-cell-value">{totalCarbsG} g</div>
            <div className="fuel-cell-sub">across {goalDisplay}</div>
          </div>
          <div className="fuel-cell">
            <div className="fuel-cell-label">Rate</div>
            <div className="fuel-cell-value">
              {carbRateGPerHr.toFixed(0)}
              <span style={{ fontSize: 18, color: 'rgba(8,8,8,.35)' }}>g/hr</span>
            </div>
            <div className="fuel-cell-sub">target {carbTargetGPerHr} g/hr · coach-set</div>
          </div>
        </>
      )}
    </div>
  );
}
