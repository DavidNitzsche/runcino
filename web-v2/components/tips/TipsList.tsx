'use client';

/**
 * TipsList — browse-all-tips view for /tips. Each row is a clickable card
 * that opens the same FormTipModal used in the run-detail surface.
 */

import { useState } from 'react';
import { allTips, type FormTip } from '@/lib/training/form-tips';
import { FormTipDetail } from '@/components/runs/FormTipModal';

export function TipsList() {
  const [openTip, setOpenTip] = useState<FormTip | null>(null);
  const tips = allTips();
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {tips.map((t) => (
          <button
            key={t.key}
            onClick={() => setOpenTip(t)}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'rgba(255,255,255,0.025)',
              border: '1px solid var(--line)',
              borderRadius: 12, padding: '18px 22px', cursor: 'pointer',
              fontFamily: 'inherit', transition: 'background .12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, color: 'var(--ink)', letterSpacing: '0.3px' }}>
                  {t.title}
                </div>
                <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--mute)', marginTop: 4, lineHeight: 1.45 }}>
                  {t.oneLiner}
                </div>
              </div>
              <span style={{
                fontFamily: 'var(--f-label)', fontSize: 11, color: 'var(--learn)',
                letterSpacing: '1.2px', flexShrink: 0, marginLeft: 14,
              }}>
                READ →
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {t.bands.map((b) => (
                <span key={b.label} style={{
                  fontFamily: 'var(--f-body)', fontSize: 10, color: 'rgba(246,247,248,0.55)',
                  padding: '3px 9px', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 999,
                }}>
                  {b.range}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>

      {openTip && (
        <div
          onClick={() => setOpenTip(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.78)', backdropFilter: 'blur(10px)',
            zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 32,
            overflowY: 'auto',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#181a1d', border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.55)', borderRadius: 20,
              padding: '28px 32px', maxWidth: 720, width: '100%',
              marginTop: 40, marginBottom: 60,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
              <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--learn)', letterSpacing: '1.6px', fontWeight: 700, textTransform: 'uppercase' }}>
                FORM TIP
              </div>
              <button onClick={() => setOpenTip(null)} aria-label="Close" style={{
                background: 'transparent', border: 'none', color: 'var(--mute)',
                fontSize: 24, cursor: 'pointer', lineHeight: 1,
              }}>×</button>
            </div>
            <FormTipDetail tip={openTip} currentValue={null} />
          </div>
        </div>
      )}
    </>
  );
}
