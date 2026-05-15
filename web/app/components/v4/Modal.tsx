'use client';

/**
 * v4 modal shell — backdrop-blur overlay, centered card, ESC + backdrop
 * click to close. Used by WorkoutDetailModal and ScheduleModal.
 *
 * Two affordances:
 *   - <Modal open={…} onClose={…} width={520}><Modal.Body /></Modal>
 *   - <ModalClose /> for the X in the top-right corner.
 */

import type { ReactNode } from 'react';
import { useEffect } from 'react';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Card width in pixels (520 for workout detail, 860 for schedule). */
  width?: number;
  children: ReactNode;
}

export function Modal({ open, onClose, width = 520, children }: ModalProps) {
  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(13,15,18,.48)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: open ? 1 : 0,
        pointerEvents: open ? 'all' : 'none',
        transition: 'opacity 0.2s ease',
      }}
    >
      <div
        style={{
          background: 'var(--surface, #FFFFFF)',
          borderRadius: '24px',
          boxShadow: '0 24px 80px rgba(0,0,0,.22)',
          position: 'relative',
          transform: open ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.98)',
          transition: 'transform 0.25s cubic-bezier(.22,.68,0,1.2)',
          maxHeight: '90vh',
          overflowY: 'auto',
          width: `${width}px`,
          maxWidth: 'calc(100vw - 32px)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalClose({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: 'absolute',
        top: '20px',
        right: '20px',
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background: 'rgba(13,15,18,.07)',
        border: 'none',
        cursor: 'pointer',
        fontSize: '15px',
        color: 'rgba(13,15,18,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
      }}
      aria-label="Close"
    >
      ✕
    </button>
  );
}
