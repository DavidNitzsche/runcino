'use client';

/**
 * DoneRunBar — the small "DONE · TYPE · X MI" pill that sits at the top
 * of /today after the run is logged. The ENTIRE bar is clickable; clicking
 * anywhere opens the run-detail modal in place.
 *
 * Used to be a card with a tiny "TAP FOR DETAILS →" link in the corner
 * — only that link triggered the modal, the rest of the bar was dead
 * pixels. Now the whole row is one button so the obvious target works.
 */
import { useState } from 'react';
import { RunDetailModal } from '@/components/runs/RunDetailModal';

export function DoneRunBar({ activityId, label }: { activityId: string; label: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        type="button"
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center', gap: 12,
          background: 'linear-gradient(135deg, rgba(62,189,65,0.08), rgba(62,189,65,0.02))',
          border: '1px solid rgba(62,189,65,0.28)',
          borderRadius: 16,
          padding: '18px 22px',
          cursor: 'pointer',
          textAlign: 'left',
          font: 'inherit', color: 'inherit',
          transition: 'background .12s, border-color .12s, transform .08s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(62,189,65,0.12), rgba(62,189,65,0.04))';
          e.currentTarget.style.borderColor = 'rgba(62,189,65,0.42)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'linear-gradient(135deg, rgba(62,189,65,0.08), rgba(62,189,65,0.02))';
          e.currentTarget.style.borderColor = 'rgba(62,189,65,0.28)';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <span style={{
          background: 'rgba(62,189,65,0.14)', color: 'var(--green)',
          padding: '3px 9px', borderRadius: 999, fontSize: 9, fontWeight: 800, letterSpacing: '1.2px',
        }}>DONE</span>
        <span style={{
          fontFamily: 'var(--f-display)', fontSize: 28, color: 'var(--ink)',
          letterSpacing: '0.5px', lineHeight: 1,
        }}>
          {label}
        </span>
        <span style={{
          marginLeft: 'auto',
          fontFamily: 'var(--f-label)', fontSize: 12,
          color: 'var(--green)', letterSpacing: '1.2px',
        }}>
          TAP FOR DETAILS →
        </span>
      </button>
      {open && <RunDetailModal activityId={activityId} onClose={() => setOpen(false)} />}
    </>
  );
}
