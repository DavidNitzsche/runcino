'use client';

const DAYS = [
  { dn: 'M', dm: 'rest',     h: 0,   c: null,      done: false, miss: false },
  { dn: 'T', dm: '6 easy',   h: 38,  c: '#14C08C', done: true,  miss: false },
  { dn: 'W', dm: '8 tempo',  h: 64,  c: '#FF8847', done: true,  miss: false },
  { dn: 'T', dm: 'easy',     h: 30,  c: null,      done: false, miss: true  },
  { dn: 'F', dm: '5 rec',    h: 30,  c: '#27B4E0', done: true,  miss: false },
  { dn: 'S', dm: '16 long',  h: 100, c: '#F3AD38', done: true,  miss: false },
  { dn: 'S', dm: '4 shake',  h: 26,  c: '#27B4E0', done: true,  miss: false },
];

export function WeeklyCheckIn({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div className={`ov${open ? ' open' : ''}`}>
      <div className="ovbg" onClick={onClose} />
      <div className="ovcard weekci">
        <div className="ovx" onClick={onClose} role="button" tabIndex={0}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
        <div className="wc-body">
          <div className="wc-tag">WEEK 14 · BUILD PHASE</div>
          <div className="wc-h">A strong<br/>week.</div>
          <div className="wc-sub">May 19 – May 25</div>
          <div className="wc-stats">
            <div><div className="v">47<small> mi</small></div><div className="k">DISTANCE</div></div>
            <div><div className="v">4<small>/5</small></div><div className="k">SESSIONS</div></div>
            <div><div className="v up">+3<small> mi</small></div><div className="k">VS LAST WK</div></div>
          </div>
          <div className="wc-lbl">THE WEEK</div>
          <div className="wc-week">
            {DAYS.map((d, i) => (
              <div key={i} className={`wc-day${d.miss ? ' miss' : ''}`}>
                {d.h > 0 ? (
                  <div className="bar" style={{ height: `${d.h}%`, background: d.c ?? 'transparent' }}>
                    {d.done && (
                      <svg className="chk" viewBox="0 0 24 24" fill="none" stroke="#9af0bf" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                    )}
                  </div>
                ) : (
                  <div className="bar" style={{ height: '6%', background: 'rgba(255,255,255,.12)' }} />
                )}
                <div className="dn">{d.dn}</div>
                <div className="dm">{d.dm}</div>
              </div>
            ))}
          </div>
          <div className="wc-lbl">FAFF SAYS</div>
          <div className="wc-coach">
            <span className="ct">COACH</span>
            <span className="cx">You <b>nailed the long run and Wednesday&rsquo;s tempo</b>, both right on target. Skipping Thursday&rsquo;s easy was the right call after a short night. Load is climbing cleanly. Same shape next week, a touch more volume.</span>
          </div>
          <div className="wc-lbl">NEXT WEEK</div>
          <div className="wc-next">
            <div className="wc-nexthero">Peak build, biggest week yet<small>50 mi · key session 2 × 3 mi @ threshold</small></div>
            <div className="wc-nrow"><span className="nk">Volume</span><span className="nv">50 mi · +3</span></div>
            <div className="wc-nrow"><span className="nk">Quality days</span><span className="nv">Tue threshold · Sat long</span></div>
            <div className="wc-nrow"><span className="nk">CIM</span><span className="nv">191 days out</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
