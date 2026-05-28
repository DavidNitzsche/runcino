'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/** + ADD SHOE — inline form. */
export function AddShoeButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [cap, setCap] = useState('400');
  const [pending, startPending] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    if (!brand.trim() || !model.trim()) { setErr('Brand + model required'); return; }
    startPending(async () => {
      try {
        const r = await fetch('/api/shoe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ brand, model, mileage_cap: Number(cap) || 400 }),
        });
        if (!r.ok) { setErr((await r.json()).error ?? 'Save failed'); return; }
        setOpen(false); setBrand(''); setModel(''); setCap('400');
        router.refresh();
      } catch (e: any) { setErr(e.message ?? String(e)); }
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        background: 'rgba(62,189,65,0.10)', color: 'var(--green)',
        border: '1px solid rgba(62,189,65,0.30)', borderRadius: 8,
        padding: '8px 14px', fontFamily: 'var(--f-label)', fontSize: 12, letterSpacing: '1.2px',
        cursor: 'pointer',
      }}>+ ADD SHOE</button>
    );
  }

  return (
    <div className="card" style={{ padding: '14px 18px', marginTop: 12, border: '1px solid var(--green)', background: 'rgba(62,189,65,0.04)' }}>
      <div className="card-eyebrow" style={{ color: 'var(--green)' }}>NEW SHOE</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 10 }}>
        <input placeholder="Brand (e.g. Nike)" value={brand} onChange={(e) => setBrand(e.target.value)} style={inputStyle()} />
        <input placeholder="Model (e.g. Vaporfly 3)" value={model} onChange={(e) => setModel(e.target.value)} style={inputStyle()} />
        <input placeholder="Cap" type="number" value={cap} onChange={(e) => setCap(e.target.value)} style={{ ...inputStyle(), width: 80 }} />
      </div>
      {err && <div style={{ color: 'var(--over)', fontSize: 11, marginTop: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button onClick={save} disabled={pending} style={primaryBtn(pending)}>{pending ? '…' : 'SAVE'}</button>
        <button onClick={() => { setOpen(false); setErr(null); }} style={secondaryBtn()}>CANCEL</button>
      </div>
    </div>
  );
}

/**
 * Preset shoe color swatches (#162). Strava-style palette. The user picks one
 * to disambiguate same-model shoes (two SC Trainer V3s become easy to tell
 * apart on the card grid). Stored as a hex color in shoes.color.
 */
const SWATCHES: { label: string; hex: string }[] = [
  { label: 'red',     hex: '#FC4D64' },
  { label: 'orange',  hex: '#FF8847' },
  { label: 'amber',   hex: '#F3AD38' },
  { label: 'green',   hex: '#3EBD41' },
  { label: 'cyan',    hex: '#27B4E0' },
  { label: 'blue',    hex: '#008FEC' },
  { label: 'purple',  hex: '#B084FF' },
  { label: 'pink',    hex: '#FF66B2' },
  { label: 'white',   hex: '#E5E7EB' },
  { label: 'black',   hex: '#0E1014' },
  { label: 'grey',    hex: '#6B7280' },
];

interface ShoeCardData {
  id: string;
  name: string;
  brand: string;
  model: string;
  color?: string | null;
  color2?: string | null;
  notes?: string | null;
  runTypes?: string[];
  mileage: number;
  cap: number;
  pctUsed: number;
  retired?: boolean;
}

/**
 * Build the card background from one or two colors.
 *
 * RULE: always two colors / two shades. Never fade to black or card-bg.
 *  - Two colors → diagonal gradient between them, with a dark veil
 *    layered on top so text reads at any color combo.
 *  - One color → two-shade gradient of the same hue (lighter → darker)
 *    so we still get depth without fading to bg.
 *  - No color  → neutral slate gradient (two slate shades).
 */
function shoeBackground(c1: string | null | undefined, c2: string | null | undefined): string {
  if (c1 && c2) {
    return `linear-gradient(135deg, rgba(8,10,14,0.45), rgba(8,10,14,0.62)), linear-gradient(135deg, ${c1}, ${c2})`;
  }
  if (c1) {
    const lighter = adjustLightness(c1, +10);
    const darker  = adjustLightness(c1, -25);
    return `linear-gradient(135deg, rgba(8,10,14,0.40), rgba(8,10,14,0.60)), linear-gradient(135deg, ${lighter}, ${darker})`;
  }
  return 'linear-gradient(160deg, #2a2f38 0%, #181c22 100%)';
}

/** Hex helper — shift HSL lightness by N points. Used to derive the
 *  second shade for single-color shoe cards so we never fade to black. */
function adjustLightness(hex: string, deltaPct: number): string {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return hex;
  const r = parseInt(m[1], 16) / 255;
  const g = parseInt(m[2], 16) / 255;
  const b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0; const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const newL = Math.max(0, Math.min(100, l * 100 + deltaPct)) / 100;
  // hsl → rgb back to hex
  const c = (1 - Math.abs(2 * newL - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m2 = newL - c / 2;
  let r2 = 0, g2 = 0, b2 = 0;
  if (h < 60)       { r2 = c; g2 = x; b2 = 0; }
  else if (h < 120) { r2 = x; g2 = c; b2 = 0; }
  else if (h < 180) { r2 = 0; g2 = c; b2 = x; }
  else if (h < 240) { r2 = 0; g2 = x; b2 = c; }
  else if (h < 300) { r2 = x; g2 = 0; b2 = c; }
  else              { r2 = c; g2 = 0; b2 = x; }
  const toHex = (v: number) => Math.round((v + m2) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

/**
 * ShoeEditCard (#162) — tap card to open a rich detail modal with
 * color picker, purpose chips, mileage + cap edit, notes, and retire.
 * Card itself gets a colored left-edge stripe so two same-model shoes
 * are visually distinct at a glance.
 */
export function ShoeEditCard({ shoe }: { shoe: ShoeCardData }) {
  const router = useRouter();
  const [openModal, setOpenModal] = useState(false);

  const barColor = shoe.pctUsed >= 80 ? 'var(--over)' : shoe.pctUsed >= 60 ? 'var(--goal)' : 'var(--green)';
  const desaturate = shoe.retired ? 'saturate(0.3)' : 'none';
  // 2026-05-27 David: "this isnt working with the color. just make
  // simple cards for now" — dropped the per-shoe gradient background.
  // All cards now use the standard dark card surface so they read as
  // a clean grid. Color stripe + edit modal still know each shoe's
  // color for future re-use; we just don't paint the whole card with it.

  return (
    <>
      <button
        onClick={() => setOpenModal(true)}
        style={{
          background: '#1f2226',
          border: '1px solid var(--line2)',
          padding: 18,
          textAlign: 'left',
          cursor: 'pointer',
          display: 'block',
          width: '100%',
          overflow: 'hidden',
          filter: desaturate,
          borderRadius: 14,
          color: 'inherit', font: 'inherit',
          transition: 'transform .08s, background .12s, border .12s',
          minHeight: 150,
        }}
        onMouseEnter={(e) => {
          if (!shoe.retired) e.currentTarget.style.background = '#24272c';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = '#1f2226';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <div style={{
          fontFamily: 'var(--f-display)', fontSize: 18, color: 'var(--ink)',
          lineHeight: 1.15, letterSpacing: '0.3px',
        }}>{shoe.name}</div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 12 }}>
          <span style={{
            fontFamily: 'var(--f-display)', fontSize: 30, color: barColor,
            letterSpacing: '0.5px',
          }}>{shoe.mileage}</span>
          <span style={{ fontSize: 12, color: 'var(--mute)' }}>
            / {shoe.cap} mi
          </span>
        </div>

        <div style={{
          height: 4, background: 'rgba(255,255,255,0.06)',
          borderRadius: 2, marginTop: 8, overflow: 'hidden',
        }}>
          <div style={{ height: '100%', width: `${Math.min(100, shoe.pctUsed)}%`, background: barColor }} />
        </div>

        {shoe.runTypes && shoe.runTypes.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {shoe.runTypes.slice(0, 3).map((p) => (
              <span key={p} style={{
                fontFamily: 'var(--f-label)', fontSize: 9, letterSpacing: '0.8px',
                color: 'var(--mute)',
                padding: '3px 7px',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 4, fontWeight: 700,
              }}>{p.toUpperCase()}</span>
            ))}
          </div>
        )}
      </button>

      {openModal && (
        <ShoeDetailModal
          shoe={shoe}
          onClose={() => setOpenModal(false)}
          onSaved={() => { setOpenModal(false); router.refresh(); }}
        />
      )}
    </>
  );
}

/**
 * ShoeDetailModal (#162) — full edit sheet for one shoe.
 *
 * Sections:
 *   - color picker (preset swatches + custom hex)
 *   - purpose multi-select chips (daily / long / quality / race / trail)
 *   - mileage + cap fields
 *   - notes textarea
 *   - retire button + save
 */
function ShoeDetailModal({
  shoe, onClose, onSaved,
}: {
  shoe: ShoeCardData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [color, setColor] = useState(shoe.color ?? '');
  const [color2, setColor2] = useState(shoe.color2 ?? '');
  const [notes, setNotes] = useState(shoe.notes ?? '');
  const [runTypes, setRunTypes] = useState<string[]>(shoe.runTypes ?? []);
  const [mileage, setMileage] = useState(String(shoe.mileage));
  const [cap, setCap] = useState(String(shoe.cap));
  const [pending, startPending] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [colorTarget, setColorTarget] = useState<'primary' | 'secondary'>('primary');

  function togglePurpose(p: string) {
    setRunTypes((rt) => rt.includes(p) ? rt.filter((x) => x !== p) : [...rt, p]);
  }

  function setActiveColor(hex: string) {
    if (colorTarget === 'primary') setColor(hex);
    else setColor2(hex);
  }

  function save() {
    setErr(null);
    startPending(async () => {
      try {
        const r = await fetch('/api/shoe', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: Number(shoe.id),
            color: color || null,
            color2: color2 || null,
            notes: notes.trim() || null,
            run_types: runTypes,
            mileage: Number(mileage),
            mileage_cap: Number(cap),
          }),
        });
        if (!r.ok) { setErr((await r.json()).error ?? 'Save failed'); return; }
        onSaved();
      } catch (e: any) { setErr(e.message ?? String(e)); }
    });
  }

  function retire() {
    if (pending) return;
    startPending(async () => {
      try {
        await fetch('/api/shoe', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: Number(shoe.id), retired: true }),
        });
        onSaved();
      } catch (e: any) { setErr(e.message ?? String(e)); }
    });
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(8,8,10,0.78)', backdropFilter: 'blur(10px)',
        zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#181a1d', border: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.55)', borderRadius: 20,
          padding: '24px 28px', maxWidth: 560, width: '100%', maxHeight: '85vh', overflow: 'auto',
        }}
      >
        {/* Header — gradient preview chip shows what the card will look like */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <span style={{
            width: 48, height: 48, borderRadius: 10,
            background: shoeBackground(color || null, color2 || null),
            border: '1px solid rgba(255,255,255,0.12)',
            flexShrink: 0,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: 22, letterSpacing: '0.4px', lineHeight: 1.1, color: 'var(--ink)' }}>
              {shoe.name}
            </div>
            <div style={{ fontFamily: 'var(--f-body)', fontSize: 11, color: 'var(--mute)', marginTop: 4 }}>
              {shoe.mileage} / {shoe.cap} mi · {Math.min(100, shoe.pctUsed)}% used
            </div>
          </div>
        </div>

        {/* Color picker — primary + secondary. Picks land on whichever
         * slot is currently active. Tap a slot chip to switch which one
         * the swatches paint. */}
        <Section title="COLOR · 1-2 picks">
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <ColorSlot
              label="PRIMARY"
              hex={color}
              active={colorTarget === 'primary'}
              onSelect={() => setColorTarget('primary')}
              onClear={() => setColor('')}
            />
            <ColorSlot
              label="SECONDARY"
              hex={color2}
              active={colorTarget === 'secondary'}
              onSelect={() => setColorTarget('secondary')}
              onClear={() => setColor2('')}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SWATCHES.map((s) => {
              const target = colorTarget === 'primary' ? color : color2;
              const active = target.toLowerCase() === s.hex.toLowerCase();
              return (
                <button
                  key={s.hex}
                  type="button"
                  onClick={() => setActiveColor(s.hex)}
                  title={s.label}
                  style={{
                    width: 30, height: 30, borderRadius: 8,
                    background: s.hex,
                    border: active ? '2px solid var(--ink)' : '2px solid transparent',
                    boxShadow: active ? '0 0 0 1px rgba(255,255,255,0.2)' : 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                />
              );
            })}
            <input
              type="text"
              placeholder="#hex"
              value={colorTarget === 'primary' ? color : color2}
              onChange={(e) => setActiveColor(e.target.value)}
              style={{
                ...inputStyle(),
                width: 90, fontSize: 11,
              }}
            />
          </div>
        </Section>

        {/* Purpose */}
        <Section title="PURPOSE">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {['daily', 'long', 'quality', 'race', 'trail'].map((p) => {
              const active = runTypes.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePurpose(p)}
                  style={{
                    background: active ? 'var(--green)' : 'rgba(255,255,255,0.04)',
                    color: active ? '#0e1014' : 'var(--ink)',
                    border: `1px solid ${active ? 'var(--green)' : 'rgba(255,255,255,0.10)'}`,
                    padding: '6px 12px', borderRadius: 8,
                    fontFamily: 'var(--f-label)', fontSize: 10, letterSpacing: '1px',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >{p.toUpperCase()}</button>
              );
            })}
          </div>
        </Section>

        {/* Mileage + cap */}
        <Section title="MILEAGE">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <label style={miniLabel}>CURRENT</label>
              <input type="number" value={mileage} onChange={(e) => setMileage(e.target.value)} style={{ ...inputStyle(), width: '100%' }} />
            </div>
            <div>
              <label style={miniLabel}>CAP</label>
              <input type="number" value={cap} onChange={(e) => setCap(e.target.value)} style={{ ...inputStyle(), width: '100%' }} />
            </div>
          </div>
        </Section>

        {/* Notes */}
        <Section title="NOTES">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Race-day pair · left foot hot spot · etc."
            rows={2}
            style={{
              ...inputStyle(),
              width: '100%',
              resize: 'vertical',
              fontFamily: 'var(--f-body)',
            }}
          />
        </Section>

        {err && <div style={{ color: 'var(--over)', fontSize: 12, marginTop: 6 }}>{err}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
          <button onClick={retire} disabled={pending} style={{
            background: 'transparent', color: 'var(--over)', border: '1px solid var(--over)',
            borderRadius: 8, padding: '8px 14px',
            fontFamily: 'var(--f-label)', fontSize: 11, letterSpacing: '1px', fontWeight: 700,
            cursor: pending ? 'wait' : 'pointer',
          }}>RETIRE</button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onClose} style={secondaryBtn()}>CANCEL</button>
            <button onClick={save} disabled={pending} style={primaryBtn(pending)}>
              {pending ? '…' : 'SAVE'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ColorSlot — one of two interactive slot chips at the top of the color
 * picker. Tap to make swatches paint into this slot.
 */
function ColorSlot({
  label, hex, active, onSelect, onClear,
}: {
  label: string;
  hex: string;
  active: boolean;
  onSelect: () => void;
  onClear: () => void;
}) {
  const empty = !hex;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px 6px 6px', borderRadius: 8,
        background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
        border: `1px solid ${active ? 'var(--ink)' : 'rgba(255,255,255,0.10)'}`,
        cursor: 'pointer', color: 'inherit', font: 'inherit',
      }}
    >
      <span style={{
        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
        background: empty ? 'rgba(255,255,255,0.04)' : hex,
        border: '1px solid rgba(255,255,255,0.18)',
      }} />
      <span style={{
        fontFamily: 'var(--f-label)', fontSize: 10, letterSpacing: '1px',
        fontWeight: 700,
        color: active ? 'var(--ink)' : 'var(--mute)',
      }}>{label}</span>
      {!empty && (
        <span
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          style={{
            fontSize: 14, color: 'var(--mute)', cursor: 'pointer',
            padding: '0 2px', lineHeight: 1,
          }}
        >×</span>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="card-eyebrow" style={{ color: 'var(--mute)', marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

const miniLabel: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--f-label)',
  fontSize: 9, color: 'var(--mute)',
  letterSpacing: '1.1px', marginBottom: 4,
};

function inputStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-body)', fontSize: 13, color: 'var(--ink)',
    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)',
    borderRadius: 6, padding: '6px 8px',
  };
}
function primaryBtn(pending: boolean): React.CSSProperties {
  return {
    background: 'var(--green)', color: '#001', border: 'none', borderRadius: 8,
    padding: '8px 14px', fontFamily: 'var(--f-label)', fontSize: 11,
    letterSpacing: '1px', fontWeight: 700,
    cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1,
  };
}
function secondaryBtn(): React.CSSProperties {
  return {
    background: 'transparent', color: 'var(--mute)', border: '1px solid var(--line)',
    borderRadius: 8, padding: '8px 14px', fontFamily: 'var(--f-label)', fontSize: 11,
    letterSpacing: '1px', fontWeight: 700, cursor: 'pointer',
  };
}
