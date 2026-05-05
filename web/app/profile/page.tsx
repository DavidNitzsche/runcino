'use client';

import { useEffect, useRef, useState } from 'react';
import { Nav } from '../../components/nav';
import { Modal } from '../../components/modal';
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
  const [shoes, setShoes]       = useState<Shoe[]>([]);
  const [loading, setLoading]   = useState(true);
  const [editingShoe, setEditingShoe] = useState<Shoe | null>(null);
  const [addingShoe, setAddingShoe]   = useState(false);
  const [longDay, setLongDay]   = useState(DEFAULT_LONG_DAY);

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
    setEditingShoe(null);
  }

  async function addShoe(input: { brand: string; model: string; color: string; run_types: RunType[]; mileage: number; mileage_cap: number; preferred: boolean; notes: string }) {
    const res = await fetch('/api/shoes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const d = await res.json();
    setShoes(s => [...s, d.shoe]);
    setAddingShoe(false);
  }

  const active  = shoes.filter(s => !s.retired);
  const retired = shoes.filter(s => s.retired);

  return (
    <div className="stage">
      <Nav active="profile" />
      <div className="body">

        <div className="page-head" style={{ marginBottom: 32 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 8 }}>ATHLETE PROFILE</div>
            <h1 style={{ fontSize: 48, letterSpacing: '-0.03em' }}>Profile</h1>
          </div>
        </div>

        {/* ── Training preferences ──────────────────────────────── */}
        <section style={{ marginBottom: 40 }}>
          <div className="tile-sub" style={{ marginBottom: 16 }}>TRAINING SCHEDULE</div>
          <div className="tile" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                      padding: '7px 12px', borderRadius: 8, border: '1px solid', cursor: 'pointer',
                      borderColor: longDay === d ? 'var(--color-attention)' : 'var(--color-l4)',
                      background: longDay === d ? 'var(--color-attention)' : 'transparent',
                      color: longDay === d ? 'var(--color-l0)' : 'var(--color-t2)',
                      fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-t3)', paddingTop: 4, borderTop: '1px solid var(--color-l4)' }}>
              Long run anchors the week. Coach fills remaining days as training load requires.
            </div>
          </div>
        </section>

        {/* ── Shoe Closet ──────────────────────────────────────── */}
        <section>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div className="tile-sub">SHOE CLOSET</div>
            <button
              className="btn btn--primary"
              style={{ padding: '8px 16px', fontSize: 12 }}
              onClick={() => setAddingShoe(true)}
            >
              + Add shoe
            </button>
          </div>

          {loading && (
            <div style={{ color: 'var(--color-t3)', fontSize: 13, padding: '24px 0' }}>Loading closet…</div>
          )}

          {active.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12, marginBottom: 16 }}>
              {active.map(shoe => (
                <ShoeCard
                  key={shoe.id}
                  shoe={shoe}
                  onEdit={() => setEditingShoe(shoe)}
                  onToggleRetired={() => toggleRetired(shoe)}
                />
              ))}
            </div>
          )}

          {retired.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <div className="tile-sub" style={{ marginBottom: 12, opacity: 0.6 }}>RETIRED</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {retired.map(shoe => (
                  <ShoeCard
                    key={shoe.id}
                    shoe={shoe}
                    retired
                    onEdit={() => setEditingShoe(shoe)}
                    onToggleRetired={() => toggleRetired(shoe)}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ── Modals ───────────────────────────────────────────────── */}
      {addingShoe && (
        <Modal title="New shoe" onClose={() => setAddingShoe(false)}>
          <ShoeForm
            onSave={data => addShoe(data)}
            onCancel={() => setAddingShoe(false)}
            submitLabel="Add to closet"
          />
        </Modal>
      )}

      {editingShoe && (
        <Modal title={`${editingShoe.brand} ${editingShoe.model}`} onClose={() => setEditingShoe(null)}>
          <ShoeForm
            initial={editingShoe}
            onSave={data => saveShoe(editingShoe.id, data)}
            onCancel={() => setEditingShoe(null)}
            submitLabel="Save changes"
          />
        </Modal>
      )}
    </div>
  );
}

// ── Shoe card ─────────────────────────────────────────────────────────────────

function ShoeCard({
  shoe, retired = false, onEdit, onToggleRetired,
}: {
  shoe: Shoe; retired?: boolean; onEdit: () => void; onToggleRetired: () => void;
}) {
  const cap     = shoe.mileage_cap ?? 500;
  const pct     = Math.min(100, (shoe.mileage / cap) * 100);
  const warning = pct >= 80 && pct < 100;
  const over    = pct >= 100;
  const barClr  = over ? 'var(--color-race)' : warning ? 'var(--color-warn)' : 'var(--color-success)';

  return (
    <div className="tile" style={{ opacity: retired ? 0.55 : 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <div className="tile-sub">{shoe.brand.toUpperCase()}</div>
            {shoe.preferred && !retired && (
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '1px',
                padding: '2px 6px', borderRadius: 3,
                background: 'rgba(62,189,65,0.12)', color: 'var(--color-success)',
                textTransform: 'uppercase',
              }}>IN ROTATION</span>
            )}
          </div>
          <div className="tile-lbl" style={{ fontSize: 18, marginTop: 2 }}>{shoe.model}</div>
          {shoe.color && (
            <div style={{ fontSize: 12, color: 'var(--color-t3)', marginTop: 2 }}>{shoe.color}</div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={onEdit} style={{ ...iconBtnStyle, width: 'auto', padding: '0 10px', fontSize: 11, fontWeight: 600, color: 'var(--color-t2)', letterSpacing: '0.02em' }}>Edit</button>
          <button onClick={onToggleRetired} title={retired ? 'Restore' : 'Retire'} style={iconBtnStyle}>
            {retired ? '↩' : '✕'}
          </button>
        </div>
      </div>

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

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-t3)', marginBottom: 4 }}>
          <span>{shoe.mileage.toFixed(0)} mi</span>
          <span style={{ color: over ? 'var(--color-race)' : warning ? 'var(--color-warn)' : undefined }}>
            {over ? '⚠ Retire — ' : warning ? '⚠ ' : ''}{cap} mi cap
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

// ── Shoe mileage cap lookup ───────────────────────────────────────────────────

const SHOE_CAPS: Array<{ match: RegExp; cap: number }> = [
  // Carbon-plate racers (200–300 mi)
  { match: /alphafly|vaporfly|dragonfly|adizero adios pro|metaspeed (sky|edge)|sc pacer|supercomp pacer|endorphin pro|mach x|pk/i, cap: 250 },
  { match: /sc trainer|sc elite|rc elite|zoomx streakfly/i, cap: 300 },
  // Plush daily / long-run trainers (450–500 mi)
  { match: /superblast|bondi|clifton|ghost|vomero|invincible|nimbus|cumulus|gel-nimbus|gel-kayano/i, cap: 500 },
  // Versatile tempo / daily (400 mi)
  { match: /zoom fly|novablast|endorphin speed|adizero boston|launch|kinvara|glide|freedom|guide/i, cap: 400 },
  // Recovery / plush (400–450 mi)
  { match: /recover|recharge|relief|jog|walk|carbon x|arahi|kayano/i, cap: 450 },
];

function suggestCap(brand: string, model: string, runTypes: RunType[]): number {
  const key = `${brand} ${model}`;
  for (const entry of SHOE_CAPS) {
    if (entry.match.test(key)) return entry.cap;
  }
  return runTypes.length > 0 ? MILEAGE_CAPS[runTypes[0]] : 400;
}

// ── Shared shoe form (add + edit) ─────────────────────────────────────────────

function ShoeForm({
  initial,
  onSave,
  onCancel,
  submitLabel,
}: {
  initial?: Shoe;
  onSave: (data: { brand: string; model: string; color: string; run_types: RunType[]; mileage: number; mileage_cap: number; preferred: boolean; notes: string }) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [brand,     setBrand]     = useState(initial?.brand ?? '');
  const [model,     setModel]     = useState(initial?.model ?? '');
  const [color,     setColor]     = useState(initial?.color ?? '');
  const [types,     setTypes]     = useState<RunType[]>(initial?.run_types ?? []);
  const [mileage,   setMileage]   = useState(String(initial?.mileage ?? 0));
  const [cap,       setCap]       = useState(String(initial?.mileage_cap ?? ''));
  const [capSource, setCapSource] = useState<'auto' | 'manual'>(initial?.mileage_cap ? 'manual' : 'auto');
  const [preferred, setPreferred] = useState(initial?.preferred ?? true);
  const [notes,     setNotes]     = useState(initial?.notes ?? '');
  const brandRef = useRef(brand);
  const modelRef = useRef(model);
  brandRef.current = brand;
  modelRef.current = model;

  useEffect(() => {
    if (capSource === 'manual') return;
    const suggested = suggestCap(brand, model, types);
    setCap(String(suggested));
  }, [brand, model, types, capSource]);

  const toggleType = (t: RunType) =>
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const suggestedCap = suggestCap(brand, model, types);
  const canSubmit = brand.trim() && model.trim() && types.length > 0;
  const resolvedCap = cap ? parseFloat(cap) : suggestedCap;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {ALL_RUN_TYPES.map(t => {
            const on = types.includes(t);
            return (
              <button key={t} onClick={() => toggleType(t)} style={{
                padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div className="runcino-label">Current mileage</div>
          <input className="runcino-input" type="number" min="0" value={mileage}
            onChange={e => setMileage(e.target.value)} placeholder="0" />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
            <div className="runcino-label" style={{ marginBottom: 0 }}>Mileage cap</div>
            {capSource === 'auto' && cap && (
              <span style={{ fontSize: 10, color: 'var(--color-recovery)', fontFamily: 'var(--font-data)', letterSpacing: '0.5px' }}>AUTO</span>
            )}
            {capSource === 'manual' && (
              <button onClick={() => setCapSource('auto')} style={{
                fontSize: 10, color: 'var(--color-t3)', background: 'none', border: 'none',
                cursor: 'pointer', padding: 0, fontFamily: 'var(--font-data)', letterSpacing: '0.5px',
              }}>reset</button>
            )}
          </div>
          <input className="runcino-input" type="number" min="0" value={cap}
            onChange={e => { setCap(e.target.value); setCapSource('manual'); }}
            placeholder={String(suggestedCap)} />
        </div>
      </div>

      <div>
        <div className="runcino-label">Notes</div>
        <input className="runcino-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
      </div>

      {/* Preferred rotation toggle */}
      <button
        onClick={() => setPreferred(p => !p)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', borderRadius: 10,
          border: '1px solid',
          borderColor: preferred ? 'var(--color-success)' : 'var(--color-l4)',
          background: preferred ? 'rgba(62,189,65,0.08)' : 'transparent',
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
        }}
      >
        <div style={{
          width: 20, height: 20, borderRadius: 5, border: '1.5px solid',
          borderColor: preferred ? 'var(--color-success)' : 'var(--color-l4)',
          background: preferred ? 'var(--color-success)' : 'transparent',
          display: 'grid', placeItems: 'center', flexShrink: 0,
          color: '#fff', fontSize: 12, fontWeight: 700,
        }}>
          {preferred ? '✓' : ''}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: preferred ? 'var(--color-success)' : 'var(--color-t2)' }}>
            In active rotation
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-t3)', marginTop: 2 }}>
            Coach assigns this shoe to runs automatically
          </div>
        </div>
      </button>

      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button
          className="btn btn--primary"
          style={{ flex: 1 }}
          disabled={!canSubmit}
          onClick={() => onSave({
            brand: brand.trim(),
            model: model.trim(),
            color: color.trim(),
            run_types: types,
            mileage: parseFloat(mileage) || 0,
            mileage_cap: resolvedCap,
            preferred,
            notes: notes.trim(),
          })}
        >
          {submitLabel}
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
