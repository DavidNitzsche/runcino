'use client';

export function Reach({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: () => void }) {
  return (
    <div className={`ov${open ? ' open' : ''}`}>
      <div className="ovbg" onClick={onClose} />
      <div className="ovcard reach">
        <div className="ovx" onClick={onClose} role="button" tabIndex={0}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
        <div className="reach-tag">
          <svg viewBox="0 0 24 24" fill="none" stroke="#FFE9B0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>
          WITHIN REACH
        </div>
        <div className="reach-h">Your 5K best<br/>is right there.</div>
        <div className="reach-seconds"><span>YOU&rsquo;RE</span><b>8 seconds</b><span>AWAY</span></div>
        <div className="reach-beam">
          <div className="reach-beamrow"><span>RECENT 20:24</span><span>5K PR · 20:16</span></div>
          <div className="reach-track">
            <div className="reach-fill" />
            <span className="reach-goaltick" />
            <div className="reach-now" />
          </div>
        </div>
        <div className="reach-coach">
          <span className="ct">COACH</span>
          <span className="cx">Your last three tempo runs put a <b>5K PR within one good effort</b>. You&rsquo;re not chasing it. You&rsquo;re basically already there. Want to make it official?</span>
        </div>
        <div className="reach-goal">
          <div className="gi">
            <svg viewBox="0 0 24 24" fill="none" stroke="#FFE9B0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v6M12 22v-6M2 12h6M22 12h-6"/><circle cx="12" cy="12" r="3"/></svg>
          </div>
          <div>
            <div className="gl">SUGGESTED GOAL</div>
            <div className="gt">5K · break 20:00</div>
            <div className="gd">~3 to 4 weeks · one focused effort</div>
          </div>
        </div>
        <div className="reach-acts">
          <button className="reach-acc" onClick={onAdd}>Add this goal &rarr;</button>
          <button className="reach-later" onClick={onClose}>Maybe later</button>
        </div>
      </div>
    </div>
  );
}
