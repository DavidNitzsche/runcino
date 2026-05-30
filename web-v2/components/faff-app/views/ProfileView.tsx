'use client';

import { useEffect, useState } from 'react';
import type { FaffSeed, ShoeRec } from '../types';
import { ROLECOL } from '../constants';

const ROLES = ['RACE','TEMPO','LONG','EASY','RECOVERY'];

export function ProfileView({ seed, onOpenPro, onOpenPaywall }: { seed: FaffSeed; onOpenPro: () => void; onOpenPaywall: () => void }) {
  const [garage, setGarage] = useState<ShoeRec[]>(seed.shoes);
  const [editing, setEditing] = useState<number | null>(null);
  const [units, setUnits] = useState('Miles · °F');
  const [notif, setNotif] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('faffGarageOverlay');
      if (raw) setGarage(JSON.parse(raw) as ShoeRec[]);
    } catch { /* swallow */ }
  }, []);
  function saveGarage(next: ShoeRec[]) {
    setGarage(next);
    try { localStorage.setItem('faffGarageOverlay', JSON.stringify(next)); } catch { /* swallow */ }
  }

  return (
    <>
      <div className="top">
        <div>
          <div className="date">Profile</div>
          <div className="wk">Account &amp; settings</div>
        </div>
      </div>

      <div className="pfhead">
        <div className="pfav">{seed.user.initial}</div>
        <div className="pfid">
          <div className="pfn">{seed.user.name}</div>
          <div className="pfm">{seed.user.city} · Runner</div>
        </div>
        <span className="pfpro" onClick={onOpenPro} style={{ cursor: 'pointer' }}>FAFF PRO</span>
      </div>

      <div className="fll" style={{ marginTop: 30 }}>SHOE GARAGE</div>
      <div className="garage">
        {garage.map((s, i) => {
          const pct = Math.min(100, Math.round((s.mi / s.max) * 100));
          const col = ROLECOL[s.role] ?? '#14C08C';
          const worn = s.mi >= s.max;
          return (
            <div className="shoe" key={i} onClick={() => setEditing(i)} role="button" tabIndex={0}>
              <span className="shedit">
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
              </span>
              <div className="shrow">
                <span className="shn">{s.nm} <i className="shr">{s.role}</i></span>
                <span className="shm" style={worn ? { color: '#FC6076' } : undefined}>{s.mi}<small> / {s.max} mi</small></span>
              </div>
              <div className="shtrk"><div className="shfill" style={{ width: `${pct}%`, background: col }} /></div>
            </div>
          );
        })}
      </div>
      <button className="shoe-add" onClick={() => setEditing(-1)}>
        <span>+</span> Add a shoe
      </button>

      <div className="fll" style={{ marginTop: 30 }}>SETTINGS</div>
      <div className="setlist">
        <div className="setr" onClick={() => setUnits(units === 'Miles · °F' ? 'Kilometers · °C' : 'Miles · °F')}>
          <span className="setk">UNITS</span><span className="setv">{units}</span><span className="sgo">›</span>
        </div>
        <div className="setr">
          <span className="setk">CONNECTED</span>
          <span className="setv">{seed.connections.filter(c => c.on).map(c => c.nm).join(' · ') || 'None'}</span>
          <span className="sgo">›</span>
        </div>
        <div className="setr" onClick={() => setNotif(!notif)}>
          <span className="setk">NOTIFICATIONS</span><span className="setv" style={{ opacity: notif ? 1 : 0.5 }}>{notif ? 'On' : 'Off'}</span><span className="sgo">›</span>
        </div>
        <div className="setr">
          <span className="setk">COACHING ROLE</span><span className="setv">Runner</span><span className="sgo">›</span>
        </div>
        <div className="setr" onClick={onOpenPaywall}>
          <span className="setk">SUBSCRIPTION</span><span className="setv">Faff Pro · renews Dec</span><span className="sgo">›</span>
        </div>
        <div className="setr danger">
          <span className="setk">SIGN OUT</span><span className="setv"></span>
        </div>
      </div>

      <ShoeEditor
        editing={editing}
        garage={garage}
        onClose={() => setEditing(null)}
        onSave={(rec) => {
          if (editing == null) return;
          const next = editing >= 0 ? garage.map((s, i) => i === editing ? rec : s) : [...garage, rec];
          saveGarage(next);
          setEditing(null);
        }}
        onDelete={() => {
          if (editing == null || editing < 0) return;
          const next = garage.filter((_, i) => i !== editing);
          saveGarage(next);
          setEditing(null);
        }}
      />
    </>
  );
}

function ShoeEditor({
  editing, garage, onClose, onSave, onDelete,
}: {
  editing: number | null;
  garage: ShoeRec[];
  onClose: () => void;
  onSave: (s: ShoeRec) => void;
  onDelete: () => void;
}) {
  const isAdd = editing === -1;
  const initial: ShoeRec = editing != null && editing >= 0 ? garage[editing] : { nm: '', role: 'EASY', mi: 0, max: 400 };
  const [nm, setNm]   = useState(initial.nm);
  const [role, setRole] = useState(initial.role);
  const [mi, setMi]   = useState(initial.mi);
  const [max, setMax] = useState(initial.max);

  useEffect(() => {
    setNm(initial.nm); setRole(initial.role); setMi(initial.mi); setMax(initial.max);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing == null) return null;
  return (
    <div className="ov open">
      <div className="ovbg" onClick={onClose} />
      <div className="ovcard shoe-ed">
        <div className="ovx" onClick={onClose} role="button" tabIndex={0}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
        <div className="se-title">{isAdd ? 'Add a shoe' : 'Edit shoe'}</div>
        <div className="se-lbl">SHOE NAME</div>
        <input className="se-input" value={nm} placeholder="e.g. Vaporfly 3" onChange={(e) => setNm(e.target.value)} spellCheck={false} />
        <div className="se-lbl">ROLE</div>
        <div className="se-roles">
          {ROLES.map(r => (
            <button
              key={r}
              className={`se-role${role === r ? ' on' : ''}`}
              style={{ borderColor: role === r ? ROLECOL[r] : 'transparent' }}
              onClick={() => setRole(r)}
            >
              <span className="sd" style={{ background: ROLECOL[r] }} />{r}
            </button>
          ))}
        </div>
        <div className="se-two">
          <div>
            <div className="se-lbl">MILES ON THEM</div>
            <input className="se-input" type="number" inputMode="numeric" min={0} value={mi} onChange={(e) => setMi(parseInt(e.target.value || '0', 10))} />
          </div>
          <div>
            <div className="se-lbl">RETIRE AT</div>
            <input className="se-input" type="number" inputMode="numeric" min={50} value={max} onChange={(e) => setMax(parseInt(e.target.value || '400', 10))} />
          </div>
        </div>
        <div className="se-acts">
          {!isAdd && <button className="se-del" onClick={onDelete}>Remove shoe</button>}
          <button className="se-save" onClick={() => onSave({ nm: nm.trim() || 'New shoe', role, mi: Math.max(0, mi), max: Math.max(50, max) })}>Save</button>
        </div>
      </div>
    </div>
  );
}
