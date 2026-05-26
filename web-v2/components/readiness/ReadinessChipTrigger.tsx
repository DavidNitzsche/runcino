'use client';

import { useState } from 'react';
import type { ReadinessBreakdown as RB } from '@/lib/coach/readiness';
import { ReadinessBreakdownView } from './ReadinessBreakdown';

/** Clickable readiness chip — tap opens an inline breakdown sheet (§8.3). */
export function ReadinessChipTrigger({ breakdown }: { breakdown: RB }) {
  const [open, setOpen] = useState(false);
  const color = breakdown.band === 'sharp' || breakdown.band === 'ready' ? 'var(--green)'
    : breakdown.band === 'moderate' ? 'var(--goal)'
                                    : 'var(--over)';
  const r = 26;
  const C = 2 * Math.PI * r;
  const off = C * (1 - breakdown.score / 100);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 64, height: 64, position: 'relative',
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        aria-label={`Readiness ${breakdown.score} (${breakdown.label}) — tap for breakdown`}
      >
        <svg viewBox="0 0 64 64" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
          <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
          <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} />
        </svg>
        <span style={{ fontFamily: 'var(--f-display)', fontSize: 26, color, letterSpacing: '0.5px' }}>
          {breakdown.score}
        </span>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.78)', backdropFilter: 'blur(10px)',
            zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              // Opaque, slightly raised. Was var(--card) which is semi-transparent
              // and washed out against the blurred page underneath.
              background: '#181a1d',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
              borderRadius: 20,
              padding: '28px 32px', maxWidth: 480, width: '100%', maxHeight: '80vh', overflow: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, fontWeight: 700, color: 'var(--mute)', letterSpacing: '1.6px', textTransform: 'uppercase' }}>
                READINESS · BREAKDOWN
              </div>
              <button onClick={() => setOpen(false)} style={{
                background: 'transparent', border: 'none', color: 'var(--mute)', fontSize: 18, cursor: 'pointer',
              }} aria-label="Close">×</button>
            </div>
            <ReadinessBreakdownView breakdown={breakdown} />
          </div>
        </div>
      )}
    </>
  );
}
