'use client';

/**
 * FormTipModal — opens when a form stat tile is tapped. Shows definition,
 * target bands, where the current value lands, and drills to fix when
 * the value is flagged.
 *
 * Trigger: <FormStatButton> renders a clickable tile.
 * Standalone: <FormTipDetail> renders the same body for the /tips page.
 */

import { useState, useEffect } from 'react';
import { tipFor, type FormTip, type FormTipBand } from '@/lib/training/form-tips';

export function FormStatButton({
  metricKey, value, unit, label, hint,
}: {
  metricKey: string;
  value: string;
  unit: string;
  label: string;
  hint: string;
}) {
  const [open, setOpen] = useState(false);
  const tip = tipFor(metricKey);
  return (
    <>
      <button
        onClick={() => tip && setOpen(true)}
        disabled={!tip}
        style={{
          padding: '10px 12px',
          background: 'rgba(255,255,255,0.025)',
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.05)',
          textAlign: 'left',
          cursor: tip ? 'pointer' : 'default',
          width: '100%',
          fontFamily: 'inherit',
          transition: 'background .12s',
        }}
        onMouseEnter={(e) => { if (tip) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
        onMouseLeave={(e) => { if (tip) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
      >
        <div style={{ fontFamily: 'var(--f-display)', fontSize: 20, color: 'var(--ink)', lineHeight: 1, letterSpacing: '0.3px' }}>
          {value}{unit ? ' ' + unit : ''}
        </div>
        <div style={{ fontFamily: 'var(--f-body)', fontSize: 9.5, color: 'var(--mute)', letterSpacing: '1.1px', textTransform: 'uppercase', marginTop: 4 }}>
          {label}
        </div>
        {hint && (
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: bandColor(hint), marginTop: 4, fontStyle: 'italic' }}>
            {hint} {tip && <span style={{ color: 'var(--learn)', fontStyle: 'normal' }}>· tap</span>}
          </div>
        )}
      </button>
      {open && tip && <FormTipModal tip={tip} currentValue={parseFloat(value) || null} onClose={() => setOpen(false)} />}
    </>
  );
}

function bandColor(hint: string): string {
  const h = hint.toLowerCase();
  if (h.includes('elite') || h.includes('efficient') || h.includes('optimal')) return 'var(--green)';
  if (h.includes('room') || h.includes('flag') || h.includes('leak') || h.includes('overstrid') || h.includes('long contact')) return 'var(--goal)';
  return 'var(--learn)';
}

function FormTipModal({ tip, currentValue, onClose }: { tip: FormTip; currentValue: number | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.78)', backdropFilter: 'blur(10px)',
      zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 32,
      overflowY: 'auto',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#181a1d', border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.55)', borderRadius: 20,
        padding: '28px 32px', maxWidth: 720, width: '100%', marginTop: 40, marginBottom: 60,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--learn)', letterSpacing: '1.6px', fontWeight: 700, textTransform: 'uppercase' }}>
            FORM TIP
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'transparent', border: 'none', color: 'var(--mute)',
            fontSize: 24, cursor: 'pointer', lineHeight: 1,
          }}>×</button>
        </div>
        <FormTipDetail tip={tip} currentValue={currentValue} />
      </div>
    </div>
  );
}

/** Body content — also used standalone on the /tips page. */
export function FormTipDetail({ tip, currentValue }: { tip: FormTip; currentValue: number | null }) {
  const userBand = currentValue != null ? tip.classify(currentValue) : null;
  return (
    <>
      <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 36, color: 'var(--ink)', letterSpacing: '0.5px', margin: '0 0 6px', lineHeight: 1.05 }}>
        {tip.title}
      </h2>
      <div style={{ fontFamily: 'var(--f-body)', fontSize: 13.5, color: 'var(--mute)', marginBottom: 18, fontStyle: 'italic' }}>
        {tip.oneLiner}
      </div>

      {/* Your current value + classification */}
      {currentValue != null && userBand && (
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12, padding: '16px 18px', marginBottom: 18,
          borderLeft: `3px solid ${bandToCss(userBand.band)}`,
        }}>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: 'var(--mute)', letterSpacing: '1.4px', fontWeight: 700, textTransform: 'uppercase' }}>
            YOUR LATEST
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 4 }}>
            <span style={{ fontFamily: 'var(--f-display)', fontSize: 36, color: 'var(--ink)', lineHeight: 1, letterSpacing: '0.3px' }}>
              {currentValue}
            </span>
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 12, color: 'var(--mute)', letterSpacing: '1.2px' }}>
              {tip.unit}
            </span>
            <span style={{
              padding: '3px 9px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '1.2px',
              background: `${bandToCss(userBand.band)}22`, color: bandToCss(userBand.band),
              marginLeft: 'auto',
            }}>
              {userBand.label.toUpperCase()}
            </span>
          </div>
          <div style={{ fontFamily: 'var(--f-body)', fontSize: 13, color: 'rgba(246,247,248,0.78)', marginTop: 6, lineHeight: 1.5 }}>
            {userBand.meaning}
          </div>
        </div>
      )}

      {/* What it is + why it matters */}
      <h3 style={{ fontFamily: 'var(--f-label)', fontSize: 16, color: 'var(--ink)', letterSpacing: '0.3px', margin: '14px 0 6px' }}>
        What it is
      </h3>
      <p style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'rgba(246,247,248,0.85)', lineHeight: 1.6, margin: '0 0 12px' }}>
        {tip.whatItIs}
      </p>

      <h3 style={{ fontFamily: 'var(--f-label)', fontSize: 16, color: 'var(--ink)', letterSpacing: '0.3px', margin: '14px 0 6px' }}>
        Why it matters
      </h3>
      <p style={{ fontFamily: 'var(--f-body)', fontSize: 14, color: 'rgba(246,247,248,0.85)', lineHeight: 1.6, margin: '0 0 12px' }}>
        {tip.whyItMatters}
      </p>

      {/* Bands table */}
      <h3 style={{ fontFamily: 'var(--f-label)', fontSize: 16, color: 'var(--ink)', letterSpacing: '0.3px', margin: '14px 0 8px' }}>
        Where it lands
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
        {tip.bands.map((b) => (
          <div key={b.label} style={{
            display: 'grid', gridTemplateColumns: '110px 130px 1fr',
            gap: 14, padding: '10px 12px',
            background: userBand?.label === b.label ? 'rgba(255,255,255,0.05)' : 'transparent',
            border: `1px solid ${userBand?.label === b.label ? bandToCss(b.band) : 'rgba(255,255,255,0.04)'}`,
            borderLeft: `3px solid ${bandToCss(b.band)}`,
            borderRadius: 8,
            alignItems: 'baseline',
          }}>
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 10, color: bandToCss(b.band), letterSpacing: '1.2px', fontWeight: 700, textTransform: 'uppercase' }}>
              {b.band}
            </span>
            <span style={{ fontFamily: 'var(--f-label)', fontSize: 13, color: 'var(--ink)' }}>
              {b.range}
            </span>
            <span style={{ fontFamily: 'var(--f-body)', fontSize: 12.5, color: 'rgba(246,247,248,0.72)', lineHeight: 1.5 }}>
              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{b.label}.</span> {b.meaning}
            </span>
          </div>
        ))}
      </div>

      {/* Drills — only meaningful when band is fine/flag */}
      {(!userBand || userBand.band === 'fine' || userBand.band === 'flag') && tip.drillsWhenFlagged.length > 0 && (
        <>
          <h3 style={{ fontFamily: 'var(--f-label)', fontSize: 16, color: 'var(--goal)', letterSpacing: '0.3px', margin: '20px 0 8px' }}>
            What to do about it
          </h3>
          <ol style={{ paddingLeft: 22, margin: 0, fontFamily: 'var(--f-body)', fontSize: 14, color: 'rgba(246,247,248,0.85)', lineHeight: 1.65 }}>
            {tip.drillsWhenFlagged.map((d, i) => (
              <li key={i} style={{ marginBottom: 6 }}>{d}</li>
            ))}
          </ol>
        </>
      )}
    </>
  );
}

function bandToCss(b: FormTipBand['band']): string {
  return b === 'elite' ? 'var(--green)'
       : b === 'good'  ? 'var(--green)'
       : b === 'fine'  ? 'var(--goal)'
       :                 'var(--over)';
}
