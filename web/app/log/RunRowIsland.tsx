'use client';

/**
 * Client wrapper for a Recent Runs row. Whole row is clickable to
 * open the detail modal, except the shoe-picker cell (clicking the
 * shoe dropdown shouldn't trigger the row-level handler).
 */

import { type ReactNode } from 'react';
import { useRunDetailModal } from './RunDetailModal';

export function RunRowIsland({ runId, children }: { runId: string; children: ReactNode }) {
  const { open } = useRunDetailModal();
  return (
    <div
      role="button"
      tabIndex={0}
      className="run-row"
      data-run-id={runId}
      onClick={(e) => {
        // Don't trigger modal on the shoe-picker cell
        const target = e.target as HTMLElement;
        if (target.closest('.run-shoe-wrap')) return;
        open(runId);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(runId);
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      {children}
    </div>
  );
}
