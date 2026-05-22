'use client';

/**
 * /profile · modal trigger buttons.
 *
 * The server page renders this as a small client island for each
 * "Edit Profile" / "Edit Prefs" / "+ Add Shoe" / per-shoe row /
 * accent picker.
 *
 * Modes that ship real forms today:
 *   - 'edit-shoe'   — pre-populated edit modal + soft-retire button
 *   - 'add-shoe'    — empty form, POST /api/shoes
 *   - 'edit-accent' — brand color picker (swatches + custom hex)
 *
 * Modes still on the original placeholder:
 *   - 'edit-profile' / 'edit-prefs' — coming in a follow-up commit
 */

import { useEffect, useState } from 'react';
import type { Shoe, RunType } from '@/lib/shoe-utils';

type Mode = 'edit-profile' | 'edit-prefs' | 'add-shoe' | 'edit-shoe' | 'edit-accent';

interface Props {
  mode: Mode;
  // edit-profile / edit-prefs hints (unused by the placeholder body but
  // kept for forward-compat with the real modals that land next).
  initialName?: string;
  initialAge?: number | null;
  initialSex?: 'M' | 'F' | null;
  initialLocation?: string | null;
  initialLevel?: string;
  initialLongRunDay?: string;
  initialQualityDays?: string[];
  initialRestDay?: string;
  // edit-shoe payload
  initialShoe?: Shoe | null;
  // edit-accent current value
  initialAccent?: string | null;
  /** Override the trigger button label (e.g. "Edit" on a shoe row). */
  triggerLabel?: string;
  /** Render the trigger as a plain wrapper so the parent controls
   *  the click target (used by the shoe rotation rows). */
  triggerAs?: 'button-pill' | 'wrap-children' | 'inline-link';
  children?: React.ReactNode;
}

const LABELS: Record<Mode, string> = {
  'edit-profile': 'Edit Profile',
  'edit-prefs':   'Edit Prefs',
  'add-shoe':     '+ Add Shoe',
  'edit-shoe':    'Edit',
  'edit-accent':  'Change accent',
};

const EYEBROWS: Record<Mode, string> = {
  'edit-profile': 'Identity',
  'edit-prefs':   'Training Profile',
  'add-shoe':     'Shoe Rotation',
  'edit-shoe':    'Shoe Rotation',
  'edit-accent':  'Brand Accent',
};

/** Default faff.run orange — kept in sync with --orange in profile-v4.css. */
const DEFAULT_ACCENT = '#E85D26';

const ACCENT_SWATCHES: { label: string; hex: string }[] = [
  { label: 'Orange', hex: '#E85D26' },
  { label: 'Blue',   hex: '#008FEC' },
  { label: 'Green',  hex: '#3EBD41' },
  { label: 'Purple', hex: '#7C3AED' },
  { label: 'Red',    hex: '#FC4D64' },
  { label: 'Teal',   hex: '#0EA5A4' },
  { label: 'Pink',   hex: '#EC4899' },
  { label: 'Amber',  hex: '#F3AD38' },
];

const RUN_TYPES: { value: RunType; label: string }[] = [
  { value: 'easy',      label: 'Easy' },
  { value: 'long',      label: 'Long' },
  { value: 'recovery',  label: 'Recovery' },
  { value: 'tempo',     label: 'Tempo' },
  { value: 'intervals', label: 'Intervals' },
  { value: 'race',      label: 'Race' },
  { value: 'as_needed', label: 'As needed' },
];

export function ProfileModalsIsland(props: Props) {
  const [open, setOpen] = useState(false);
  const isHero = props.mode === 'edit-profile';
  const triggerStyle = props.triggerAs ?? (isHero ? 'button-pill' : 'button-pill');
  const cls = isHero ? 'identity-edit' : 'card-action';
  const label = props.triggerLabel ?? LABELS[props.mode];

  const trigger = triggerStyle === 'wrap-children' ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'block',
        width: '100%',
      }}
    >
      {props.children}
    </button>
  ) : triggerStyle === 'inline-link' ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      style={{
        all: 'unset',
        cursor: 'pointer',
        fontFamily: 'Oswald, sans-serif',
        fontWeight: 600,
        fontSize: 11,
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        color: 'var(--accent, var(--orange, #E85D26))',
      }}
    >
      {label}
    </button>
  ) : (
    <button className={cls} type="button" onClick={() => setOpen(true)}>
      {label}
    </button>
  );

  return (
    <>
      {trigger}
      {open && (
        <ModalOverlay onClose={() => setOpen(false)}>
          {props.mode === 'edit-shoe' && (
            <ShoeForm shoe={props.initialShoe ?? null} onClose={() => setOpen(false)} />
          )}
          {props.mode === 'add-shoe' && (
            <ShoeForm shoe={null} onClose={() => setOpen(false)} />
          )}
          {props.mode === 'edit-accent' && (
            <AccentForm current={props.initialAccent ?? null} onClose={() => setOpen(false)} />
          )}
          {(props.mode === 'edit-profile' || props.mode === 'edit-prefs') && (
            <PlaceholderForm mode={props.mode} onClose={() => setOpen(false)} />
          )}
        </ModalOverlay>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shared modal chrome
// ─────────────────────────────────────────────────────────────────────

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(8,8,8,.55)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        zIndex: 1000, padding: '60px 24px', overflowY: 'auto', backdropFilter: 'blur(4px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#fff', borderRadius: 18, boxShadow: '0 30px 80px rgba(0,0,0,.25)',
        maxWidth: 560, width: '100%', padding: '36px 40px 32px',
      }}>
        {children}
      </div>
    </div>
  );
}

function ModalHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <>
      <div style={{
        fontFamily: 'Inter, sans-serif', fontSize: 11, letterSpacing: '2px',
        textTransform: 'uppercase', color: 'rgba(8,8,8,.35)', fontWeight: 600,
      }}>{eyebrow}</div>
      <div style={{
        fontFamily: '"Bebas Neue", sans-serif', fontSize: 38, letterSpacing: '-0.5px',
        lineHeight: 1, color: '#080808', marginTop: 6,
      }}>{title.toUpperCase()}</div>
    </>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        fontFamily: 'Inter, sans-serif', fontSize: 11, letterSpacing: '1.5px',
        color: 'rgba(8,8,8,.55)', textTransform: 'uppercase', fontWeight: 600, marginBottom: 6,
      }}>{label}</div>
      {children}
      {hint && (
        <div style={{
          fontFamily: 'Inter, sans-serif', fontSize: 12, color: 'rgba(8,8,8,.45)', marginTop: 4,
        }}>{hint}</div>
      )}
    </div>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  border: '1px solid rgba(8,8,8,.16)', fontFamily: 'Inter, sans-serif',
  fontSize: 14, color: '#080808', outline: 'none',
};

function PrimaryButton({ children, onClick, disabled, color }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 12,
        letterSpacing: '1.5px', textTransform: 'uppercase',
        padding: '11px 22px', borderRadius: 9, cursor: disabled ? 'wait' : 'pointer',
        background: color ?? '#080808', color: '#fff', border: 'none',
        opacity: disabled ? 0.6 : 1,
      }}
    >{children}</button>
  );
}

function SecondaryButton({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 12,
        letterSpacing: '1.5px', textTransform: 'uppercase',
        padding: '11px 22px', borderRadius: 9, cursor: disabled ? 'wait' : 'pointer',
        background: 'transparent',
        color: danger ? '#FC4D64' : '#080808',
        border: `1px solid ${danger ? 'rgba(252,77,100,.35)' : 'rgba(8,8,8,.16)'}`,
        opacity: disabled ? 0.6 : 1,
      }}
    >{children}</button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      marginTop: 14, padding: '10px 14px', borderRadius: 8,
      background: 'rgba(252,77,100,.08)', border: '1px solid rgba(252,77,100,.3)',
      fontFamily: 'Inter, sans-serif', fontSize: 13, color: '#FC4D64',
    }}>{message}</div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Shoe edit / add form
// ─────────────────────────────────────────────────────────────────────

function ShoeForm({ shoe, onClose }: { shoe: Shoe | null; onClose: () => void }) {
  const isEdit = shoe != null;

  const [brand,     setBrand]     = useState(shoe?.brand ?? '');
  const [model,     setModel]     = useState(shoe?.model ?? '');
  const [color,     setColor]     = useState(shoe?.color ?? '');
  const [mileage,   setMileage]   = useState(String(Math.round(shoe?.mileage ?? 0)));
  const [cap,       setCap]       = useState(shoe?.mileage_cap != null ? String(Math.round(shoe.mileage_cap)) : '400');
  const [runTypes,  setRunTypes]  = useState<RunType[]>(shoe?.run_types ?? []);
  const [preferred, setPreferred] = useState(shoe?.preferred ?? true);
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  function toggleType(t: RunType) {
    setRunTypes((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);
  }

  async function save() {
    setError(null);
    if (!brand.trim()) return setError('Brand is required.');
    if (!model.trim()) return setError('Model is required.');
    if (runTypes.length === 0) return setError('Pick at least one purpose.');
    const mileageNum = Number(mileage || '0');
    if (!Number.isFinite(mileageNum) || mileageNum < 0 || mileageNum > 5000) {
      return setError('Mileage must be 0–5000.');
    }
    let capNum: number | null = null;
    if (cap.trim()) {
      const n = Number(cap);
      if (!Number.isFinite(n) || n < 50 || n > 2000) return setError('Cap must be 50–2000 mi.');
      capNum = n;
    }

    setBusy(true);
    try {
      const body = {
        brand: brand.trim(),
        model: model.trim(),
        color: color.trim() || null,
        run_types: runTypes,
        mileage: mileageNum,
        mileage_cap: capNum,
        preferred,
      };
      const res = isEdit
        ? await fetch(`/api/profile/shoes/${shoe!.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
        : await fetch('/api/shoes', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
      const json = await res.json() as { shoe?: Shoe; error?: string };
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      onClose();
      // Server-rendered page → hard reload so the new row shows up.
      if (typeof window !== 'undefined') window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function retire() {
    if (!isEdit) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/profile/shoes/${shoe!.id}`, { method: 'DELETE' });
      const json = await res.json() as { shoe?: Shoe; error?: string };
      if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
      onClose();
      if (typeof window !== 'undefined') window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <ModalHeader eyebrow="Shoe Rotation" title={isEdit ? 'Edit shoe' : 'Add shoe'} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 18 }}>
        <Field label="Brand"><input style={INPUT_STYLE} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Asics" maxLength={60} /></Field>
        <Field label="Model"><input style={INPUT_STYLE} value={model} onChange={(e) => setModel(e.target.value)} placeholder="Superblast 3" maxLength={80} /></Field>
      </div>

      <Field label="Color (optional)" hint="Free-form — shown in /log when picking shoes for a run.">
        <input style={INPUT_STYLE} value={color} onChange={(e) => setColor(e.target.value)} placeholder="White" maxLength={40} />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Current mileage" hint="Strava auto-adds miles after runs are tagged to this shoe.">
          <input style={INPUT_STYLE} type="number" min={0} max={5000} value={mileage} onChange={(e) => setMileage(e.target.value)} />
        </Field>
        <Field label="Mileage cap" hint="Coach flags retire-soon at 90% of cap.">
          <input style={INPUT_STYLE} type="number" min={50} max={2000} value={cap} onChange={(e) => setCap(e.target.value)} />
        </Field>
      </div>

      <Field label="Purposes" hint="Pick everything this shoe handles. Coach matches by first row that fits the run type.">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {RUN_TYPES.map((t) => {
            const active = runTypes.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => toggleType(t.value)}
                style={{
                  padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
                  fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
                  border: active ? '1px solid #080808' : '1px solid rgba(8,8,8,.16)',
                  background: active ? '#080808' : 'transparent',
                  color: active ? '#fff' : '#080808',
                }}
              >{t.label}</button>
            );
          })}
        </div>
      </Field>

      <Field label="Rotation">
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => setPreferred(true)}
            style={{
              padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
              border: preferred ? '1px solid #080808' : '1px solid rgba(8,8,8,.16)',
              background: preferred ? '#080808' : 'transparent',
              color: preferred ? '#fff' : '#080808',
            }}
          >In rotation</button>
          <button
            type="button"
            onClick={() => setPreferred(false)}
            style={{
              padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
              fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 500,
              border: !preferred ? '1px solid #080808' : '1px solid rgba(8,8,8,.16)',
              background: !preferred ? '#080808' : 'transparent',
              color: !preferred ? '#fff' : '#080808',
            }}
          >Backup</button>
        </div>
      </Field>

      {error && <ErrorBanner message={error} />}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(8,8,8,.08)', gap: 8,
      }}>
        <div>
          {isEdit && <SecondaryButton onClick={retire} disabled={busy} danger>Retire shoe</SecondaryButton>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <SecondaryButton onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
          <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add shoe'}</PrimaryButton>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Accent picker
// ─────────────────────────────────────────────────────────────────────

function AccentForm({ current, onClose }: { current: string | null; onClose: () => void }) {
  const initial = current ?? DEFAULT_ACCENT;
  const [picked, setPicked] = useState(initial);
  const [hex,    setHex]    = useState(initial);
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  function onHexChange(raw: string) {
    setHex(raw);
    const m = /^#?([0-9a-fA-F]{6})$/.exec(raw.trim());
    if (m) {
      setPicked(`#${m[1].toUpperCase()}`);
      setError(null);
    }
  }

  async function save(value: string | null) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/profile/accent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accent_color: value }),
      });
      const json = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onClose();
      // Reload so the layout repaints with the new --accent.
      if (typeof window !== 'undefined') window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <ModalHeader eyebrow="Brand Accent" title="Pick your color" />

      <Field label="Preset" hint="Tap a swatch to preview. Save applies it across the app.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {ACCENT_SWATCHES.map((s) => {
            const active = picked.toUpperCase() === s.hex.toUpperCase();
            return (
              <button
                key={s.hex}
                type="button"
                onClick={() => { setPicked(s.hex); setHex(s.hex); setError(null); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                  padding: '12px 6px', borderRadius: 10, cursor: 'pointer',
                  background: active ? 'rgba(8,8,8,.04)' : 'transparent',
                  border: active ? `2px solid ${s.hex}` : '2px solid transparent',
                  fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
                  color: active ? '#080808' : 'rgba(8,8,8,.55)',
                  letterSpacing: '1px', textTransform: 'uppercase',
                }}
              >
                <span style={{
                  width: 32, height: 32, borderRadius: 16, background: s.hex,
                  border: '1px solid rgba(8,8,8,.08)',
                }} aria-hidden="true" />
                {s.label}
              </button>
            );
          })}
        </div>
      </Field>

      <Field label="Custom hex" hint="Any 6-digit hex like #E85D26.">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span aria-hidden="true" style={{
            width: 36, height: 36, borderRadius: 8, background: picked,
            border: '1px solid rgba(8,8,8,.16)', flexShrink: 0,
          }} />
          <input
            style={{ ...INPUT_STYLE, fontFamily: 'monospace' }}
            value={hex}
            onChange={(e) => onHexChange(e.target.value)}
            placeholder="#E85D26"
            maxLength={7}
          />
        </div>
      </Field>

      <div style={{
        marginTop: 18, padding: 16, borderRadius: 10,
        background: 'rgba(8,8,8,.04)', border: '1px solid rgba(8,8,8,.08)',
      }}>
        <div style={{
          fontFamily: 'Inter, sans-serif', fontSize: 11, letterSpacing: '1.5px',
          textTransform: 'uppercase', color: 'rgba(8,8,8,.55)', fontWeight: 600,
        }}>Preview</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}>
          <span style={{
            padding: '8px 16px', background: picked, color: '#fff', borderRadius: 6,
            fontFamily: 'Oswald, sans-serif', fontSize: 11, fontWeight: 600,
            letterSpacing: '1.5px', textTransform: 'uppercase',
          }}>Primary action</span>
          <span style={{
            padding: '4px 10px', background: 'transparent', color: picked,
            border: `1px solid ${picked}`, borderRadius: 4,
            fontFamily: 'Inter, sans-serif', fontSize: 11, fontWeight: 600,
          }}>Accent pill</span>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(8,8,8,.08)', gap: 8,
      }}>
        <SecondaryButton onClick={() => save(null)} disabled={busy}>Reset to default</SecondaryButton>
        <div style={{ display: 'flex', gap: 8 }}>
          <SecondaryButton onClick={onClose} disabled={busy}>Cancel</SecondaryButton>
          <PrimaryButton onClick={() => save(picked)} disabled={busy} color={picked}>{busy ? 'Saving…' : 'Save accent'}</PrimaryButton>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Placeholder for the modes that don't have real forms yet
// ─────────────────────────────────────────────────────────────────────

function PlaceholderForm({ mode, onClose }: { mode: 'edit-profile' | 'edit-prefs'; onClose: () => void }) {
  return (
    <>
      <ModalHeader eyebrow={EYEBROWS[mode]} title={LABELS[mode]} />
      <p style={{
        fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'rgba(8,8,8,.55)',
        lineHeight: 1.55, marginTop: 24,
      }}>
        The full edit form lands in the next commit. For now, the structural
        port of /profile is live — what you see in the cards above reflects
        what your account holds.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 28, paddingTop: 20, borderTop: '1px solid rgba(8,8,8,.08)' }}>
        <PrimaryButton onClick={onClose}>Close</PrimaryButton>
      </div>
    </>
  );
}
