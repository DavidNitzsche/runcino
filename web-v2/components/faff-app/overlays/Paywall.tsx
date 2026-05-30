'use client';

import { useState } from 'react';

export function Paywall({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [plan, setPlan] = useState<'year' | 'month'>('year');
  return (
    <div className={`ov${open ? ' open' : ''}`}>
      <div className="ovbg" onClick={onClose} />
      <div className="ovcard paywall">
        <div className="ovx" onClick={onClose} role="button" tabIndex={0}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
        <div className="pay-left">
          <div className="pay-mark">FAFF PRO</div>
          <div className="pay-h">Train like<br/>you <em>mean it.</em></div>
          <div className="pay-feat">
            <Feature icon={<path d="M3 18l5-8 4 5 3-4 6 7"/>} title="A plan that adapts every day" desc="rebuilt from your readiness and results" />
            <Feature icon={<path d="M12 20s-7-4.6-7-9.6a4 4 0 0 1 7-2.4 4 4 0 0 1 7 2.4C19 15.4 12 20 12 20z"/>} title="Readiness and form science" desc="HRV, GCT, cadence, the full picture" />
            <Feature icon={<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>} title="Race projections and the gap" desc="know exactly where you stand" />
            <Feature icon={<><path d="M4 6h16M4 12h16M4 18h16"/></>} title="Unlimited history and Shoe Garage" desc="nothing capped, ever" />
          </div>
        </div>
        <div className="pay-right">
          <div className="pay-rk">CHOOSE YOUR PLAN</div>
          <div className="pay-plans">
            <div className={`pay-plan${plan === 'year' ? ' on' : ''}`} onClick={() => setPlan('year')}>
              <div className="badge">SAVE 33%</div>
              <div className="pk">ANNUAL</div>
              <div className="pp">$5.83<small>/mo</small></div>
              <div className="pd">$69.99 billed yearly</div>
            </div>
            <div className={`pay-plan${plan === 'month' ? ' on' : ''}`} onClick={() => setPlan('month')}>
              <div className="pk">MONTHLY</div>
              <div className="pp">$8.99<small>/mo</small></div>
              <div className="pd">billed monthly</div>
            </div>
          </div>
          <button className="pay-cta">Start 7-day free trial</button>
          <div className="pay-fine">Then $69.99/yr. Cancel anytime.<br/><u>Restore</u> · <u>Terms</u></div>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="pay-f">
      <div className="ic">
        <svg viewBox="0 0 24 24" fill="none" stroke="#FFE0A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </div>
      <div className="tx">{title}<span>{desc}</span></div>
    </div>
  );
}
