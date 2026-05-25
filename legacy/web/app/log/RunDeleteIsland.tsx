'use client';

/**
 * Inline ✕ delete button for each Recent Runs row.
 *
 * Sits on the far right of the row. Stops propagation so the row's
 * onClick (open detail modal) doesn't fire when the user clicks
 * delete. Confirms first, then DELETE /api/runs/[id] and reloads
 * the page so the list refreshes without the deleted row.
 *
 * This is the "delete from here" affordance — the modal also has a
 * Delete button but discoverability requires opening the modal first.
 * Inline = one click + confirm.
 */

import { useState } from 'react';

export function RunDeleteIsland({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    if (!confirm('Delete this run? For mistake imports only — can\'t be undone from the app.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Delete failed: ${j?.error ?? res.statusText}`);
        setBusy(false);
        return;
      }
      if (typeof window !== 'undefined') window.location.reload();
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : 'unknown'}`);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="run-del-btn"
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); } }}
      disabled={busy}
      aria-label="Delete this run"
      title="Delete this run"
    >
      {busy ? '…' : '×'}
      <style jsx>{`
        .run-del-btn {
          width: 28px; height: 28px;
          border: 1px solid rgba(8,8,8,.12);
          border-radius: 6px;
          background: transparent;
          color: rgba(8,8,8,.40);
          font-family: 'Inter', sans-serif;
          font-size: 18px; font-weight: 400;
          line-height: 1;
          cursor: pointer;
          padding: 0;
          display: inline-flex; align-items: center; justify-content: center;
        }
        .run-del-btn:hover {
          color: #FC4D64;
          border-color: rgba(252,77,100,.40);
          background: rgba(252,77,100,.05);
        }
        .run-del-btn:disabled {
          opacity: 0.5; cursor: wait;
        }
      `}</style>
    </button>
  );
}
