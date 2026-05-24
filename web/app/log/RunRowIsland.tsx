'use client';

/**
 * Client wrapper for a Recent Runs row. Whole row is clickable to open
 * the detail modal — except the shoe-picker cell (clicking the shoe
 * dropdown shouldn't trigger the row-level handler).
 *
 * Multi-select merge mode (MergeProvider): when the toolbar's "Merge runs"
 * toggle is on, the row shows a leading checkbox and clicking toggles
 * selection instead of opening the modal. The toolbar handles the
 * "Merge selected" commit (largest-distance row becomes canonical).
 */

import { type ReactNode } from 'react';
import { useRunDetailModal } from './RunDetailModal';
import { useMergeContext } from './MergeToolbox';

interface Props {
  runId: string;
  /** Distance in miles. Used by the toolbar to pick the largest as
   *  canonical when committing a multi-select merge. */
  distanceMi?: number;
  children: ReactNode;
}

export function RunRowIsland({ runId, distanceMi, children }: Props) {
  const { open } = useRunDetailModal();
  const { mergeMode, selected, toggle } = useMergeContext();
  const isChecked = selected.has(runId);

  return (
    <div
      role="button"
      tabIndex={0}
      className={`run-row${mergeMode ? ' merge-mode' : ''}${isChecked ? ' merge-selected' : ''}`}
      data-run-id={runId}
      data-run-distance={distanceMi ?? ''}
      onClick={(e) => {
        // Don't trigger on the shoe-picker cell
        const target = e.target as HTMLElement;
        if (target.closest('.run-shoe-wrap')) return;
        if (mergeMode) {
          toggle(runId);
          return;
        }
        open(runId);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (mergeMode) toggle(runId);
          else open(runId);
        }
      }}
      style={{ cursor: 'pointer', position: 'relative' }}
    >
      {mergeMode && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
            width: 18, height: 18, borderRadius: 4, zIndex: 2,
            border: `2px solid ${isChecked ? 'var(--race, #E88021)' : 'rgba(8,8,8,.25)'}`,
            background: isChecked ? 'var(--race, #E88021)' : '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .12s, border-color .12s',
            pointerEvents: 'none',
          }}
        >
          {isChecked && (
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M2 5.5L4.5 8L9 3" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
      )}
      {children}
    </div>
  );
}
