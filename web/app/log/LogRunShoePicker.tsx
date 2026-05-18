'use client';

/**
 * /log · Custom designed shoe picker for the Recent Runs feed.
 *
 * Replaces the native <select> in designs/log-v4.html with a v4-styled
 * dropdown — trigger + panel + colored shoe dots + status pill. POSTs
 * the new assignment to /api/runs/:id/shoe on selection.
 */

import { useEffect, useRef, useState } from 'react';

interface Shoe {
  id: number;
  name: string;
  purposes: string[];
  color: string;
}

interface Props {
  runId: string;
  currentShoeId: number | null;
  shoes: Shoe[];
}

const PURPOSE_LABEL: Record<string, string> = {
  easy: 'Easy', recovery: 'Easy', long: 'Long', threshold: 'Threshold',
  intervals: 'Intervals', race: 'Race', trail: 'Trail', daily: 'Daily',
};

export function LogRunShoePicker({ runId, currentShoeId, shoes }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(currentShoeId);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const currentShoe = shoes.find((s) => s.id === selected);

  async function assign(shoeId: number | null) {
    setOpen(false);
    if (shoeId === selected) return;
    setSelected(shoeId);
    setBusy(true);
    try {
      await fetch(`/api/runs/${runId}/shoe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shoeId }),
      });
    } catch {
      // Revert on failure
      setSelected(currentShoeId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className={`shoe-picker${open ? ' open' : ''}`}>
      <div className="shoe-picker-trigger" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
        {currentShoe ? (
          <span className="shoe-picker-dot" style={{ background: currentShoe.color }}></span>
        ) : (
          <span className="shoe-picker-dot"></span>
        )}
        <span className="shoe-picker-label">{busy ? 'Saving…' : currentShoe?.name || 'No shoe set'}</span>
        <svg className="shoe-picker-chev" viewBox="0 0 10 6" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </div>
      <div className="shoe-picker-panel">
        <div className={`shoe-picker-option is-none${!selected ? ' selected' : ''}`} onClick={() => assign(null)}>
          <span className="shoe-picker-option-dot"></span>
          <div>
            <div className="shoe-picker-option-name" style={{ color: 'var(--t2)' }}>No shoe</div>
            <div className="shoe-picker-option-meta">Clear assignment</div>
          </div>
          <span></span>
        </div>
        {shoes.map((sh) => (
          <div
            key={sh.id}
            className={`shoe-picker-option${selected === sh.id ? ' selected' : ''}`}
            onClick={() => assign(sh.id)}
          >
            <span className="shoe-picker-option-dot" style={{ background: sh.color }}></span>
            <div>
              <div className="shoe-picker-option-name">{sh.name}</div>
              <div className="shoe-picker-option-meta">
                {sh.purposes.map((p) => PURPOSE_LABEL[p] ?? p).join(' · ') || '—'}
              </div>
            </div>
            <span></span>
          </div>
        ))}
        <div className="shoe-picker-divider"></div>
        <a className="shoe-picker-manage" href="/profile">+ Manage shoes →</a>
      </div>
    </div>
  );
}
