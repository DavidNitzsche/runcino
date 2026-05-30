'use client';

export function Toast({
  visible, onClose, title, subtitle,
}: { visible: boolean; onClose: () => void; title: string; subtitle: string }) {
  return (
    <div className={`toast${visible ? ' show' : ''}`}>
      <span className="tkdot" style={{ background: '#FF8847' }} />
      <div className="tktx">
        <b>{title}</b>
        <span>{subtitle}</span>
      </div>
      <div className="tkx" onClick={onClose} role="button" tabIndex={0} aria-label="Dismiss">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </div>
    </div>
  );
}
