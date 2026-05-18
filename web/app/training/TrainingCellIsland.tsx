'use client';

/**
 * TrainingCell — clickable wrapper for a single cell in the 14-week
 * calendar grid on /training. Click opens the same workout detail
 * modal that /overview uses (via shared WorkoutModalProvider).
 *
 * Renders as a <button> styled to look identical to the previous
 * <div> (no default button paint, inherits the .cal-cell styling),
 * but with cursor:pointer + a subtle hover state.
 */

import { useModal, type WorkoutDay } from '@/app/overview/WorkoutModalIsland';
import type { ReactNode } from 'react';

interface Props {
  day: WorkoutDay;
  className: string;
  children: ReactNode;
}

export function TrainingCell({ day, className, children }: Props) {
  const { openFor } = useModal();
  return (
    <button
      type="button"
      className={`${className} cal-cell-btn`}
      onClick={() => openFor(day)}
      aria-label={`${day.label} — ${day.distanceMi} mi`}
    >
      {children}
      <style jsx>{`
        /* Override browser button defaults but leave padding/background/border
           to the .cal-cell rules in training-v4.css. The button is the cell. */
        button.cal-cell-btn {
          font: inherit;
          color: inherit;
          text-align: inherit;
          cursor: pointer;
          width: 100%;
          transition: filter 120ms ease;
        }
        button.cal-cell-btn:hover { filter: brightness(0.97); }
        button.cal-cell-btn:focus-visible {
          outline: 2px solid var(--amber, #D4900A);
          outline-offset: -2px;
        }
      `}</style>
    </button>
  );
}
