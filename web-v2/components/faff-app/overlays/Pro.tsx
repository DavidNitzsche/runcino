'use client';

const BULLETS = [
  'Daily AI plan that retunes to your recovery',
  'Live race projection and the goal gap',
  'Unlimited run history and analytics',
  'Shoe Garage with wear tracking',
  'Sleep, HRV, and training-load insights',
  'Race-day mode and pacing',
];

export function Pro({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className={`ov${open ? ' open' : ''}`}>
      <div className="ovbg" onClick={onClose} />
      <div className="ovcard pro">
        <div className="ovx" onClick={onClose} role="button" tabIndex={0}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
        <div className="prok">FAFF PRO</div>
        <div className="proh">Train like it&rsquo;s your job.</div>
        <ul className="prol">
          {BULLETS.map((b, i) => (
            <li key={i}>
              <svg viewBox="0 0 24 24" fill="none" stroke="#3EBD41" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
              {b}
            </li>
          ))}
        </ul>
        <div className="proprice">$9.99<span>/mo</span></div>
        <div className="probtn">You&rsquo;re subscribed</div>
      </div>
    </div>
  );
}
