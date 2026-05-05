'use client';

import { useEffect, useState } from 'react';
import { Nav } from '../../components/nav';
import type { Shoe, RunType } from '../../lib/shoe-utils';

const RUN_TYPE_LABELS: Record<RunType, string> = {
  race:       'Race',
  long:       'Long run',
  easy:       'Easy',
  recovery:   'Recovery',
  tempo:      'Tempo',
  intervals:  'Intervals',
  as_needed:  'As needed',
};

const ALL_RUN_TYPES: RunType[] = ['race', 'long', 'easy', 'recovery', 'tempo', 'intervals', 'as_needed'];

const MILEAGE_CAPS: Record<RunType, number> = {
  race: 300, long: 500, easy: 500, recovery: 400,
  tempo: 400, intervals: 400, as_needed: 500,
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_LONG_DAY = 'Sun';

export default function ProfilePage() {
  const [shoes, setShoes]     = useState<Shoe[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding]   = useState(false);
  const [longDay, setLongDay] = useState(DEFAULT_LONG_DAY);
  const [easyDays, setEasyDays] = useState<string[]>(['Tue', 'Thu', 'Sat']);

  useEffect(() => {
    fetch('/api/shoes')
      .then(r => r.json())
      .then(d => { setShoes(d.shoes ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function toggleRetired(shoe: Shoe) {
    const res = await fetch(`/api/shoes/${shoe.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ retired: !shoe.retired }),
    });
    const d = await res.json();
    setShoes(s => s.map(x => x.id === shoe.id ? d.shoe : x));
  }

  async function saveShoe(id: number, patch: Partial<Shoe>) {
    const res = await fetch(`/api/shoes/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const d = await res.json();
    setShoes(s => s.map(x => x.id === id ? d.shoe : x));
    setEditing(null);
  }

  async function addShoe(input: { brand: string; model: string; color: string; run_types: RunType[]; mileage_cap: number }) {
    const res = await fetch('/api/shoes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const d = await res.json();
    setShoes(s => [...s, d.shoe]);
    setAdding(false);
  }

  const active  = shoes.filter(s => !s.retired);
  const retired = shoes.filter(s => s.retired);

  return (
    <div className="stage">
      <Nav active="profile" />
      <div className="body">

        {/* ── Page header ─────────────────────────────────────────── */}
        <div className="page-head" style={{ marginBottom: 32 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>ATHLETE PROFILE</div>
            <h1 style={{ fontSize: 48, letterSpacing: '-0.03em' }}>Profile</h1>
          </div>
        </div>

        {/* ── Training day preferences ─────────────────────────────── */}
        <section style={{ marginBottom: 40 }}>
          <div className="tile-sub" style={{ marginBottom: 16 }}>TRAINING SCHEDULE PREFERENCES</div>
          <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            <div>
              <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 10, fontWeight: 500 }}>
                Long run day
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {DAYS.map(d => (
                  <button
                    key={d}
                    onClick={() => setLongDay(d)}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 8,
                      border: '1px solid',
                      borderColor: longDay === d ? 'var(--color-attention)' : 'var(--color-l4)',
                      background: longDay === d ? 'var(--color-attention)' : 'transparent',
                      color: longDay === d ? 'var(--color-l0)' : 'var(--color-t2)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, color: 'var(--color-t2)', marginBottom: 10, fontWeight: 500 }}>
                Easy / recovery run days
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {DAYS.map(d => {
                  const on = easyDays.includes(d);
                  return (
                    <button
                      key={d}
                      onClick={() => setEasyDays(prev => on ? prev.filter(x => x !== d) : [...prev, d])}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 8,
                        border: '1px solid',
                        borderColor: on ? 'var(--color-corporate)' : 'var(--color-l4)',
                        background: on ? 'rgba(79,143,247,0.12)' : 'transparent',
                        color: on ? 'var(--color-corporate)' : 'var(--color-t2)',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ fontSize: 11, color: 'var(--color-t3)', paddingTop: 4, borderTop: '1px solid var(--color-l4)' }}>
              Coach uses these to shape your weekly plan — long run anchors the week, easy days fill around it.
            </div>
          </div>
        </section>

        {/* ── Shoe Closet ─────────────────────────────────────────── */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div className="tile-sub">SHOE CLOSET</div>
            <button
              className="btn btn--primary"
              style={{ padding: '8px 16px', fontSize: 12 }}
              onClick={() => setAdding(true)}
            >
              + Add shoe
            </button>
          </div>

          {loading && (
            <div style={{ color: 'var(--color-t3)', fontSize: 13, padding: '24px 0' }}>Loading closet…</div>
          )}

          {/* Active shoes */}
          {active.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, marginBottom: 16 }}>
              {active.map(shoe => (
                editing === shoe.id
                  ? <ShoeEditCard key={shoe.id} shoe={shoe} onSave={p => saveShoe(shoe.id, p)} onCancel={() => setEditing(null)} />
                  : <ShoeCard key={shoe.id} shoe={shoe} onEdit={() => setEditing(shoe.id)} onToggleRetired={() => toggleRetired(shoe)} />
              ))}
            </div>
          )}

          {/* Add form */}
          {adding && (
            <ShoeAddCard onAdd={addShoe} onCancel={() => setAdding(false)} />
          )}

          {/* Retired */}
          {retired.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div className="tile-sub" style={{ marginBottom: 12, opacity: 0.6 }}>RETIRED</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                {retired.map(shoe => (
                  <ShoeCard key={shoe.id} shoe={shoe} retired onEdit={() => setEditing(shoe.id)} onToggleRetired={() => toggleRetired(shoe)} />
                ))}
              </div>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}

// ── Shoe card ────────────────────────────────────────────────────────────────

function ShoeCard({
  shoe, retired = false, onEdit, onToggleRetired,
}: {
  shoe: Shoe; retired?: boolean; onEdit: () => void; onToggleRetired: () => void;
}) {
  const cap    = shoe.mileage_cap ?? 500;
  const pct    = Math.min(100, (shoe.mileage / cap) * 100);
  const warn   = pct >= 80;
  const barClr = warn ? 'var(--color-warning)' : 'var(--color-success)';

  return (
    <div className="tile" style={{ opacity: retired ? 0.55 : 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="tile-sub">{shoe.brand.toUpperCase()}</div>
          <div className="tile-lbl" style={{ fontSize: 18, marginTop: 2 }}>{shoe.model}</div>
          {shoe.color && (
            <div style={{ fontSize: 12, color: 'var(--color-t3)', marginTop: 2 }}>{shoe.color}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onEdit} style={iconBtnStyle}>✏</button>
          <button onClick={onToggleRetired} title={retired ? 'Restore' : 'Retire'} style={iconBtnStyle}>
            {retired ? '↩' : '✕'}
          </button>
        </div>
      </div>

      {/* Run types */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {shoe.run_types.map(t => (
          <span key={t} style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
            background: 'var(--color-l3)', color: 'var(--color-t1)',
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            {RUN_TYPE_LABELS[t]}
          </span>
        ))}
      </div>

      {/* Mileage bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-t3)', marginBottom: 4 }}>
          <span>{shoe.mileage.toFixed(0)} mi</span>
          <span style={{ color: warn ? 'var(--color-warning)' : undefined }}>
            {warn ? '⚠ ' : ''}{cap} mi cap
          </span>
        </div>
        <div style={{ height: 4, background: 'var(--color-l3)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: barClr, borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
      </div>

      {shoe.notes && (
        <div style={{ fontSize: 12, color: 'var(--color-t3)', borderTop: '1px solid var(--color-l4)', paddingTop: 8 }}>
          {shoe.notes}
        </div>
      )}
    </div>
  );
}

// ── Edit card ────────────────────────────────────────────────────────────────

function ShoeEditCard({ shoe, onSave, onCancel }: {
  shoe: Shoe;
  onSave: (p: Partial<Shoe>) => void;
  onCancel: () => void;
}) {
  const [brand, setBrand]     = useState(shoe.brand);
  const [model, setModel]     = useState(shoe.model);
  const [color, setColor]     = useState(shoe.color ?? '');
  const [types, setTypes]     = useState<RunType[]>(shoe.run_types);
  const [cap, setCap]         = useState(String(shoe.mileage_cap ?? ''));
  const [mileage, setMileage] = useState(String(shoe.mileage));
  const [notes, setNotes]     = useState(shoe.notes ?? '');

  const toggleType = (t: RunType) =>
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  return (
    <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--color-attention)' }}>
      <div className="tile-sub">EDITING</div>
      <input className="runcino-input" value={brand} onChange={e => setBrand(e.target.value)} placeholder="Brand" />
      <input className="runcino-input" value={model} onChange={e => setModel(e.target.value)} placeholder="Model" />
      <input className="runcino-input" value={color} onChange={e => setColor(e.target.value)} placeholder="Color" />
      <div>
        <div className="runcino-label">Run types</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {ALL_RUN_TYPES.map(t => {
            const on = types.includes(t);
            return (
              <button key={t} onClick={() => toggleType(t)} style={{
                padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                border: '1px solid', cursor: 'pointer', fontFamily: 'inherit',
                borderColor: on ? 'var(--color-attention)' : 'var(--color-l4)',
                background: on ? 'var(--color-attention)' : 'transparent',
                color: on ? 'var(--color-l0)' : 'var(--color-t2)',
                textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                {RUN_TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div className="runcino-label">Current mileage</div>
          <input className="runcino-input" type="number" value={mileage} onChange={e => setMileage(e.target.value)} />
        </div>
        <div>
          <div className="runcino-label">Mileage cap</div>
          <input className="runcino-input" type="number" value={cap} onChange={e => setCap(e.target.value)} />
        </div>
      </div>
      <input className="runcino-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)" />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn--primary" style={{ flex: 1 }} onClick={() => onSave({
          brand, model, color: color || null,
          run_types: types,
          mileage: parseFloat(mileage) || 0,
          mileage_cap: cap ? parseFloat(cap) : null,
          notes: notes || null,
        })}>
          Save
        </button>
        <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Add card ─────────────────────────────────────────────────────────────────

function ShoeAddCard({ onAdd, onCancel }: {
  onAdd: (input: { brand: string; model: string; color: string; run_types: RunType[]; mileage_cap: number }) => void;
  onCancel: () => void;
}) {
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [types, setTypes] = useState<RunType[]>([]);
  const [cap, setCap]     = useState('');

  const toggleType = (t: RunType) =>
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const defaultCap = types.length > 0 ? MILEAGE_CAPS[types[0]] : 400;

  return (
    <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 12, border: '1px solid var(--color-attention)', marginBottom: 16 }}>
      <div className="tile-sub">NEW SHOE</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <div className="runcino-label">Brand</div>
          <input className="runcino-input" value={brand} onChange={e => setBrand(e.target.value)} placeholder="e.g. Nike" />
        </div>
        <div>
          <div className="runcino-label">Model</div>
          <input className="runcino-input" value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. Vaporfly 3" />
        </div>
      </div>
      <div>
        <div className="runcino-label">Color</div>
        <input className="runcino-input" value={color} onChange={e => setColor(e.target.value)} placeholder="e.g. Black / White" />
      </div>
      <div>
        <div className="runcino-label">Run types</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {ALL_RUN_TYPES.map(t => {
            const on = types.includes(t);
            return (
              <button key={t} onClick={() => toggleType(t)} style={{
                padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                border: '1px solid', cursor: 'pointer', fontFamily: 'inherit',
                borderColor: on ? 'var(--color-attention)' : 'var(--color-l4)',
                background: on ? 'var(--color-attention)' : 'transparent',
                color: on ? 'var(--color-l0)' : 'var(--color-t2)',
                textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                {RUN_TYPE_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <div className="runcino-label">Mileage cap (default {defaultCap} mi)</div>
        <input className="runcino-input" type="number" value={cap} onChange={e => setCap(e.target.value)} placeholder={String(defaultCap)} />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn btn--primary"
          style={{ flex: 1 }}
          disabled={!brand || !model || types.length === 0}
          onClick={() => onAdd({ brand, model, color, run_types: types, mileage_cap: cap ? parseFloat(cap) : defaultCap })}
        >
          Add to closet
        </button>
        <button className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  border: '1px solid var(--color-l4)',
  background: 'transparent', color: 'var(--color-t3)',
  fontSize: 12, cursor: 'pointer', display: 'grid', placeItems: 'center',
  fontFamily: 'inherit',
};
