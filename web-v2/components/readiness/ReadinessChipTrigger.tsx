'use client';

import { useState } from 'react';
import type { ReadinessBreakdown as RB } from '@/lib/coach/readiness';
import { ReadinessBreakdownView } from './ReadinessBreakdown';

/** Clickable readiness chip — tap opens an inline breakdown sheet (§8.3).
 *  size='lg' renders the big hero ring (156px) used in /today's Direction-4
 *  top hero. Default 'sm' is the original 64px corner chip. */
export function ReadinessChipTrigger({ breakdown, size = 'sm' }: { breakdown: RB; size?: 'sm' | 'lg' }) {
  const [open, setOpen] = useState(false);
  const color = breakdown.band === 'sharp' || breakdown.band === 'ready' ? 'var(--green)'
    : breakdown.band === 'moderate' ? 'var(--goal)'
                                    : 'var(--over)';
  const dim = size === 'lg' ? 156 : 64;
  const stroke = size === 'lg' ? 8 : 4;
  const r = (dim / 2) - stroke;
  const C = 2 * Math.PI * r;
  const off = C * (1 - breakdown.score / 100);
  const numSize = size === 'lg' ? 56 : 26;

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: dim, height: dim, position: 'relative',
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        aria-label={`Readiness ${breakdown.score} (${breakdown.label}) — tap for breakdown`}
      >
        <svg viewBox={`0 0 ${dim} ${dim}`} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
          <circle cx={dim / 2} cy={dim / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
          <circle cx={dim / 2} cy={dim / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={off} />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1, position: 'relative' }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: numSize, color, letterSpacing: '0.5px', fontWeight: 800 }}>
            {breakdown.score}
          </span>
          {size === 'lg' && (
            <span style={{
              fontFamily: 'var(--f-label)', fontSize: 11, color: 'var(--mute)',
              letterSpacing: '1.6px', fontWeight: 700, marginTop: 6,
            }}>
              {breakdown.label}
            </span>
          )}
        </div>
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(20,17,13,0.55)', backdropFilter: 'blur(10px)',
            zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              // Opaque card surface, slightly raised off the blurred page.
              background: 'var(--card)',
              border: '1px solid var(--line)',
              boxShadow: '0 24px 60px rgba(20,17,13,0.18)',
              borderRadius: 4,
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
