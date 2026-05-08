/**
 * ReadinessBanner — three-state (green/yellow/red) readiness chip
 * with collapsible signal list + recommended action.
 *
 * Sourced from coach.assessReadiness output. Used by:
 *   - dashboard's CoachTodayCard (today's readiness summary)
 *   - /workout/[date] (when viewing today)
 *   - /today (radically simple view)
 *   - run-detail (post-run context)
 */

'use client';

import { useState } from 'react';

export interface ReadinessBannerData {
  level: 'green' | 'yellow' | 'red';
  message: string;
  acwr: number | null;
  easyShare: number | null;
  signals: Array<{ label: string; severity: 'info' | 'warn'; detail: string }>;
  recommendedAction: string;
}

export function ReadinessBanner({ readiness }: { readiness: ReadinessBannerData }) {
  const [open, setOpen] = useState(false);
  const colors: Record<ReadinessBannerData['level'], { bg: string; fg: string; label: string; icon: string }> = {
    green:  { bg: 'rgba(16,185,129,.12)', fg: 'var(--color-success)',   label: 'READY',     icon: '●' },
    yellow: { bg: 'rgba(243,173,59,.12)', fg: 'var(--color-attention)', label: 'EASE OFF',  icon: '◐' },
    red:    { bg: 'rgba(252,77,84,.12)',  fg: 'var(--color-warning)',   label: 'PULL BACK', icon: '○' },
  };
  const c = colors[readiness.level];

  return (
    <div style={{
      padding: '10px 14px', borderRadius: 8,
      background: c.bg,
      border: `1px solid ${c.fg.replace('var(', 'rgba(').replace(')', ', 0.3)')}`,
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ color: c.fg, fontSize: 14, fontWeight: 700 }}>{c.icon}</span>
          <span style={{
            fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 800, letterSpacing: '1.6px',
            color: c.fg,
          }}>READINESS · {c.label}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, fontFamily: 'var(--font-data)', fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', color: 'var(--color-t3)', fontVariantNumeric: 'tabular-nums' }}>
          {readiness.acwr != null && <span>ACWR {readiness.acwr.toFixed(2)}</span>}
          {readiness.easyShare != null && <span>{Math.round(readiness.easyShare * 100)}% EASY</span>}
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-t1)', lineHeight: 1.5 }}>
        {readiness.message}
      </div>
      {readiness.signals.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            alignSelf: 'flex-start', padding: '3px 8px',
            fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px',
            background: 'transparent', color: 'var(--color-t3)',
            border: '1px solid var(--color-l4)', borderRadius: 4, cursor: 'pointer',
          }}
        >
          {open ? '▾ HIDE SIGNALS' : `▸ ${readiness.signals.length} SIGNAL${readiness.signals.length === 1 ? '' : 'S'}`}
        </button>
      )}
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4 }}>
          {readiness.signals.map((sig, i) => (
            <div key={i} style={{
              fontSize: 12, color: 'var(--color-t2)', lineHeight: 1.45,
              padding: '6px 10px', background: 'var(--color-l3)', borderRadius: 4,
              borderLeft: `2px solid ${sig.severity === 'warn' ? 'var(--color-attention)' : 'var(--color-corporate)'}`,
            }}>
              <div style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: sig.severity === 'warn' ? 'var(--color-attention)' : 'var(--color-corporate)' }}>
                {sig.label.toUpperCase()}
              </div>
              <div>{sig.detail}</div>
            </div>
          ))}
          <div style={{
            fontSize: 11.5, color: 'var(--color-t2)', lineHeight: 1.5,
            paddingTop: 6, borderTop: '1px solid var(--color-l4)',
          }}>
            <span style={{ fontFamily: 'var(--font-data)', fontSize: 9, fontWeight: 700, letterSpacing: '1.2px', color: 'var(--color-t3)' }}>RECOMMENDED · </span>
            {readiness.recommendedAction}
          </div>
        </div>
      )}
    </div>
  );
}
